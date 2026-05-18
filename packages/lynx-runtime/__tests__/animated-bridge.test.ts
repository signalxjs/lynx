/**
 * Tests for the BG-side SharedValue bridge (originally Phase 2.5; primitive
 * renamed in Phase 2.8).
 *
 * Step 3 (this module): wvid → signal registry + ingestAvPublishes that
 * MT-side Lynx.Sigx.AvPublish events route through. Sigx reactivity tracks
 * the signal so any `effect` that read sv.value re-runs.
 *
 * See PHASE-2.5-ANIMATED-BRIDGE-PLAN.md (repo root) for the full design.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { effect } from '@sigx/reactivity';

import {
  registerBgSink,
  unregisterBgSink,
  ingestAvPublishes,
  resetBgAvBridge,
  bgAvSinkCount,
} from '../src/animated-bridge';

beforeEach(() => {
  resetBgAvBridge();
});

describe('animated-bridge BG sink', () => {
  it('registerBgSink returns a signal seeded with the initial value', () => {
    const s = registerBgSink(1, 42);
    expect(s.value).toBe(42);
    expect(bgAvSinkCount()).toBe(1);
  });

  it('registerBgSink is idempotent on the wvid', () => {
    const a = registerBgSink(1, 'first');
    const b = registerBgSink(1, 'second');
    expect(a).toBe(b);
    // Existing value preserved — no in-flight publish lost.
    expect(a.value).toBe('first');
  });

  it('unregisterBgSink drops the sink', () => {
    registerBgSink(1, 0);
    expect(bgAvSinkCount()).toBe(1);
    unregisterBgSink(1);
    expect(bgAvSinkCount()).toBe(0);
  });

  it('ingestAvPublishes writes incoming values into the signal', () => {
    const s = registerBgSink(7, 0);
    ingestAvPublishes([[7, 100]]);
    expect(s.value).toBe(100);
  });

  it('ingestAvPublishes triggers reactive effects on the BG side', () => {
    const s = registerBgSink(1, 0);
    const seen: number[] = [];
    effect(() => {
      seen.push(s.value as number);
    });

    expect(seen).toEqual([0]);

    ingestAvPublishes([[1, 30]]);
    expect(seen).toEqual([0, 30]);

    ingestAvPublishes([[1, 31]]);
    expect(seen).toEqual([0, 30, 31]);
  });

  it('ingestAvPublishes processes multiple tuples in one call', () => {
    const a = registerBgSink(1, 0);
    const b = registerBgSink(2, 0);
    const c = registerBgSink(3, 0);

    ingestAvPublishes([[1, 'A'], [2, 'B'], [3, 'C']]);

    expect(a.value).toBe('A');
    expect(b.value).toBe('B');
    expect(c.value).toBe('C');
  });

  it('ingestAvPublishes silently skips unregistered wvids', () => {
    const s = registerBgSink(1, 'hello');
    expect(() => ingestAvPublishes([[99, 'unknown'], [1, 'world']])).not.toThrow();
    expect(s.value).toBe('world');
  });

  it('resetBgAvBridge clears every sink', () => {
    registerBgSink(1, 0);
    registerBgSink(2, 0);
    expect(bgAvSinkCount()).toBe(2);

    resetBgAvBridge();
    expect(bgAvSinkCount()).toBe(0);
  });
});

describe('bg-bridge listener routes AvPublish into ingestAvPublishes', () => {
  interface CapturedListener {
    type: string;
    fn: (e: { data: string }) => void;
  }
  const captured: CapturedListener[] = [];
  const fakeJSContext = {
    addEventListener: vi.fn((type: string, fn: (e: { data: string }) => void) => {
      captured.push({ type, fn });
    }),
  };

  beforeEach(() => {
    captured.length = 0;
    fakeJSContext.addEventListener.mockClear();
    resetBgAvBridge();
    vi.resetModules();
    vi.stubGlobal('lynx', { getCoreContext: () => fakeJSContext });
  });

  function avListener(): CapturedListener {
    const l = captured.find((c) => c.type === 'Lynx.Sigx.AvPublish');
    if (!l) throw new Error('AvPublish listener not registered');
    return l;
  }

  it('writes ingested values into the BG sink signal', async () => {
    await import('../src/bg-bridge.js');
    // Re-import is fresh — the freshly imported animated-bridge module has
    // its own registry; register the sink in the same module instance the
    // listener writes to.
    const mod = await import('../src/animated-bridge.js');
    mod.resetBgAvBridge();
    const s = mod.registerBgSink(5, 0);

    avListener().fn({ data: JSON.stringify([[5, 77]]) });

    expect(s.value).toBe(77);
  });

  it('drops malformed JSON without throwing', async () => {
    await import('../src/bg-bridge.js');
    expect(() => avListener().fn({ data: 'not-json' })).not.toThrow();
  });

  it('ignores non-array payloads', async () => {
    await import('../src/bg-bridge.js');
    const mod = await import('../src/animated-bridge.js');
    mod.resetBgAvBridge();
    const s = mod.registerBgSink(1, 'unchanged');

    avListener().fn({ data: JSON.stringify({ wvid: 1, value: 'x' }) });

    expect(s.value).toBe('unchanged');
  });
});
