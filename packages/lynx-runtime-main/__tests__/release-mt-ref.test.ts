/**
 * Tests for the MT-side OP.RELEASE_MT_REF handler.
 *
 * When the BG sends RELEASE_MT_REF(wvid), ops-apply must delete that wvid
 * from upstream's `lynxWorkletImpl._refImpl._workletRefMap` so the map
 * doesn't grow unbounded across mount/unmount cycles. This test stubs
 * lynxWorkletImpl, drives applyOps with a release op, and asserts the entry
 * was removed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import { applyOps, resetMainThreadState } from '../src/ops-apply';

beforeEach(() => {
  resetMainThreadState();
  // Mute __FlushElementTree (called at the tail of applyOps).
  vi.stubGlobal('__FlushElementTree', vi.fn());
});

describe('RELEASE_MT_REF op', () => {
  it('deletes the wvid entry from lynxWorkletImpl._refImpl._workletRefMap', () => {
    const refMap: Record<number, unknown> = {
      1: { current: null, _wvid: 1 },
      2: { current: null, _wvid: 2 },
    };
    vi.stubGlobal('lynxWorkletImpl', { _refImpl: { _workletRefMap: refMap } });

    applyOps([OP.RELEASE_MT_REF, 1]);

    expect(1 in refMap).toBe(false);
    expect(2 in refMap).toBe(true);
  });

  it('is a no-op when lynxWorkletImpl is missing', () => {
    vi.stubGlobal('lynxWorkletImpl', undefined);
    expect(() => applyOps([OP.RELEASE_MT_REF, 5])).not.toThrow();
  });

  it('is a no-op when the wvid does not exist (idempotent)', () => {
    const refMap: Record<number, unknown> = { 7: { current: null, _wvid: 7 } };
    vi.stubGlobal('lynxWorkletImpl', { _refImpl: { _workletRefMap: refMap } });

    applyOps([OP.RELEASE_MT_REF, 99]);
    expect(7 in refMap).toBe(true);
    expect(Object.keys(refMap)).toHaveLength(1);
  });
});
