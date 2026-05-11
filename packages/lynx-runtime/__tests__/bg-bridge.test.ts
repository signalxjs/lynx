/**
 * Tests for the BG-side Lynx.Sigx.PublishEvent listener.
 *
 * The MT-side hybrid worklet calls `lynx.getJSContext().dispatchEvent` with
 * a serialized `{sign, event}` payload. bg-bridge.ts subscribes and routes
 * through the existing event-registry's `publishEvent`. We mock the JS
 * context's addEventListener to capture the registered listener, then drive
 * it with payloads and assert that registered handlers fire.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { register, resetRegistry } from '../src/event-registry.js';

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
  resetRegistry();
  vi.resetModules(); // ensure bg-bridge re-runs with the fresh stubs
  // BG side uses lynx.getCoreContext() to reach MT — see bg-bridge.ts comment.
  vi.stubGlobal('lynx', { getCoreContext: () => fakeJSContext });
});

function publishListener(): CapturedListener {
  const l = captured.find((c) => c.type === 'Lynx.Sigx.PublishEvent');
  if (!l) throw new Error('PublishEvent listener not registered');
  return l;
}

describe('bg-bridge', () => {
  it('subscribes to Lynx.Sigx.PublishEvent and Lynx.Sigx.AvPublish on import', async () => {
    await import('../src/bg-bridge.js');
    const types = captured.map((c) => c.type).sort();
    expect(types).toEqual(['Lynx.Sigx.AvPublish', 'Lynx.Sigx.PublishEvent']);
  });

  it('routes valid payloads through publishEvent to the right handler', async () => {
    await import('../src/bg-bridge.js');
    const handler = vi.fn();
    const sign = register(handler);

    publishListener().fn({ data: JSON.stringify({ sign, event: { detail: 42 } }) });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ detail: 42 });
  });

  it('silently drops malformed JSON payloads', async () => {
    await import('../src/bg-bridge.js');
    const handler = vi.fn();
    register(handler);

    expect(() => {
      publishListener().fn({ data: 'not-json' });
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores payloads missing the sign field', async () => {
    await import('../src/bg-bridge.js');
    const handler = vi.fn();
    register(handler);

    publishListener().fn({ data: JSON.stringify({ event: { detail: 1 } }) });
    expect(handler).not.toHaveBeenCalled();
  });
});
