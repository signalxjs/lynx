/**
 * The SET_GESTURE_DETECTOR op must degrade gracefully on hosts that don't
 * implement the gesture PAPI — notably web (@lynx-js/web-core), where
 * `__SetGestureDetector` is undefined. Calling the vendored `processGesture`
 * there throws a ReferenceError that aborts the *entire* ops batch, so a
 * navigation push that registers the Stack's swipe-back gesture would leave the
 * pushed screen unrendered. The op handler feature-detects the PAPI and skips
 * it, keeping the rest of the batch (and the screen render) intact.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import { applyOps, resetMainThreadState } from '../src/ops-apply';
import { elements } from '../src/element-registry';

beforeEach(() => {
  resetMainThreadState();
  // __FlushElementTree is called at the end of every batch.
  vi.stubGlobal('__FlushElementTree', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMainThreadState();
});

describe('SET_GESTURE_DETECTOR web guard', () => {
  it('skips the gesture op without throwing or aborting the batch when __SetGestureDetector is absent', () => {
    // Web: the gesture PAPI is not defined.
    vi.stubGlobal('__SetGestureDetector', undefined);
    const styleCalls: unknown[] = [];
    vi.stubGlobal('__SetInlineStyles', (_el: unknown, v: unknown) => {
      styleCalls.push(v);
    });

    // Seed an element and bind a worklet-ref wvid (5) → element id (100) so the
    // gesture op resolves its target element and reaches the PAPI guard.
    elements.set(100, { __brand: 'el100' } as never);
    elements.set(200, { __brand: 'el200' } as never);
    applyOps([OP.SET_MT_REF, 100, 5]);

    // One batch: the gesture op (must be skipped) followed by a style op on a
    // different element (must still apply → proves the batch wasn't aborted and
    // the operand cursor stayed aligned).
    const batch: unknown[] = [
      OP.SET_GESTURE_DETECTOR,
      5, // elementWvid
      1, // gestureId
      0, // type
      { callbacks: [] },
      { waitFor: [], simultaneous: [], continueWith: [] },
      OP.SET_STYLE,
      200,
      { color: 'red' },
    ];

    expect(() => applyOps(batch)).not.toThrow();
    // The trailing op applied — the gesture failure did not abort the batch.
    expect(styleCalls).toEqual([{ color: 'red' }]);
  });
});
