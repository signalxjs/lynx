import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetWvidCounter, resetBgAvBridge, resetOpQueue, useSharedValue } from '@sigx/lynx';
import { animate, cancelAnimation, _resetInflight } from '../src/animate';

// `animate()` schedules ticks via `requestAnimationFrame` and triggers a
// microtask-debounced flush via `__FlushElementTree()` after every
// SharedValue write. We mock both as queue-pushers so the tick loop is fully
// deterministic. Microtasks are flushed by an explicit `await Promise.resolve()`
// where assertions need to observe the post-flush state.

let tickQueue: Array<() => void> = [];
let mockedNow = 0;

beforeEach(() => {
  resetOpQueue();
  resetBgAvBridge();
  resetWvidCounter();
  _resetInflight();
  tickQueue = [];
  mockedNow = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => mockedNow);
  (globalThis as { requestAnimationFrame?: (cb: () => void) => void })
    .requestAnimationFrame = (cb) => { tickQueue.push(cb); };
  // Stub __FlushElementTree so the debounced flush path doesn't blow up.
  (globalThis as Record<string, unknown>)['__FlushElementTree'] = () => {};
  // Reset the microtask flag between tests so debounce doesn't leak.
  delete (globalThis as Record<string, unknown>)['__sigxMotionFlushScheduled'];
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  delete (globalThis as Record<string, unknown>)['__FlushElementTree'];
  delete (globalThis as Record<string, unknown>)['__sigxMotionFlushScheduled'];
});

function flushFrames(n: number, dateAdvanceMs = 16): void {
  for (let i = 0; i < n; i++) {
    if (tickQueue.length === 0) break;
    mockedNow += dateAdvanceMs;
    const next = tickQueue.shift()!;
    next();
  }
}

describe('animate — tween', () => {
  it('progresses from start to target over the duration', () => {
    const sv = useSharedValue(0);
    const seen: number[] = [];
    animate(sv, 100, { type: 'tween', duration: 0.1 });

    // Read sv.current.value after each tick to capture intermediates —
    // sigx-native equivalent of motion's onUpdate(v) callback.
    for (let i = 0; i < 20; i++) {
      if (tickQueue.length === 0) break;
      mockedNow += 10;
      const next = tickQueue.shift()!;
      next();
      seen.push(sv.current.value);
    }

    expect(seen.length).toBeGreaterThan(2);
    expect(seen[0]).toBeGreaterThanOrEqual(0);
    expect(seen[seen.length - 1]).toBe(100);
    expect(sv.current.value).toBe(100);
  });

  it('finished resolves on natural completion', async () => {
    const sv = useSharedValue(0);
    const ctrl = animate(sv, 50, { type: 'tween', duration: 0.05 });
    flushFrames(10, 10);
    await expect(ctrl.finished).resolves.toBeUndefined();
  });

  it('snaps to target on completion (no off-by-one drift)', () => {
    const sv = useSharedValue(0);
    animate(sv, 42, { type: 'tween', duration: 0.05 });
    flushFrames(10, 10);
    expect(sv.current.value).toBe(42);
  });
});

describe('animate — spring', () => {
  it('settles at the target eventually', () => {
    const sv = useSharedValue(0);
    animate(sv, 100, { type: 'spring', stiffness: 200, damping: 20 });
    // Spring with these params settles in well under a second; flush plenty.
    flushFrames(300, 16);
    expect(sv.current.value).toBe(100);
  });

  it('updates intermediate values on the way to the target', () => {
    const sv = useSharedValue(0);
    const seen: number[] = [];
    animate(sv, 100, {
      type: 'spring',
      stiffness: 200,
      damping: 20,
    });
    // Read sv.current.value per tick — sigx-native progress observation.
    for (let i = 0; i < 300; i++) {
      if (tickQueue.length === 0) break;
      mockedNow += 16;
      const next = tickQueue.shift()!;
      next();
      seen.push(sv.current.value);
    }
    expect(seen.length).toBeGreaterThan(5);
    const intermediate = seen.slice(1, -1);
    expect(intermediate.some((v) => v > 0 && v < 100)).toBe(true);
  });
});

describe('animate — cancellation', () => {
  it('stop() halts further updates', () => {
    const sv = useSharedValue(0);
    const ctrl = animate(sv, 100, { type: 'tween', duration: 1 });
    flushFrames(2, 16);
    const valueAtStop = sv.current.value;
    ctrl.stop();
    flushFrames(50, 16);
    // Value should not progress past the stop point.
    expect(sv.current.value).toBe(valueAtStop);
  });

  it('a new animate() on the same SharedValue cancels the previous one', async () => {
    const sv = useSharedValue(0);

    const ctrl1 = animate(sv, 100, { type: 'tween', duration: 1 });
    flushFrames(2, 16);

    // Replace mid-flight with a new animation. The previous one's
    // `finished` should still resolve (cancellation, not completion).
    const ctrl2 = animate(sv, -50, { type: 'tween', duration: 0.05 });
    flushFrames(20, 16);

    await expect(ctrl1.finished).resolves.toBeUndefined();
    await expect(ctrl2.finished).resolves.toBeUndefined();
    expect(sv.current.value).toBe(-50);
  });

  it('finished resolves on cancel as well as completion', async () => {
    const sv = useSharedValue(0);
    const ctrl = animate(sv, 100, { type: 'tween', duration: 5 });
    flushFrames(1, 16);
    ctrl.stop();
    await expect(ctrl.finished).resolves.toBeUndefined();
  });

  it('cancelAnimation(sv) halts the in-flight animation and keeps the mid-flight value', async () => {
    const sv = useSharedValue(0);
    const ctrl = animate(sv, 100, { type: 'tween', duration: 1 });
    flushFrames(2, 16);
    const valueAtCancel = sv.current.value;

    cancelAnimation(sv);
    flushFrames(50, 16);

    expect(sv.current.value).toBe(valueAtCancel);
    await expect(ctrl.finished).resolves.toBeUndefined();
  });

  it('cancelAnimation is a no-op when nothing is in flight', () => {
    const sv = useSharedValue(0);
    expect(() => cancelAnimation(sv)).not.toThrow();
  });
});

describe('animate — type inference', () => {
  it('defaults to spring when no duration is set', () => {
    const sv = useSharedValue(0);
    animate(sv, 100, {});
    flushFrames(300, 16);
    // Spring settles at exactly 100 once below thresholds.
    expect(sv.current.value).toBe(100);
  });

  it('uses tween when duration is set without explicit type', () => {
    const sv = useSharedValue(0);
    animate(sv, 100, { duration: 0.05 });
    flushFrames(10, 10);
    expect(sv.current.value).toBe(100);
  });
});
