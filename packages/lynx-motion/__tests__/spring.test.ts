import { describe, it, expect } from 'vitest';
import { spring } from '../src/spring.js';

describe('spring solver', () => {
  it('starts at the origin keyframe', () => {
    const s = spring({ keyframes: [0, 100] });
    const first = s.next(0);
    expect(first.value).toBeCloseTo(0, 5);
    expect(first.done).toBe(false);
  });

  it('settles at the target eventually', () => {
    const s = spring({ keyframes: [0, 100], stiffness: 200, damping: 20 });
    let last = { done: false, value: 0 };
    for (let t = 0; t < 5000 && !last.done; t += 16) {
      last = s.next(t);
    }
    expect(last.done).toBe(true);
    expect(last.value).toBe(100);
  });

  it('underdamped springs overshoot the target', () => {
    // dampingRatio = damping / (2 * sqrt(stiffness * mass)) = 5 / (2 * sqrt(200 * 1)) ≈ 0.18
    const s = spring({ keyframes: [0, 100], stiffness: 200, damping: 5 });
    let max = 0;
    for (let t = 0; t < 3000; t += 16) {
      const step = s.next(t);
      max = Math.max(max, step.value);
      if (step.done) break;
    }
    expect(max).toBeGreaterThan(100);
  });

  it('critically damped springs do not overshoot', () => {
    // dampingRatio = 1 → critically damped
    // stiffness=100 mass=1 → undamped freq sqrt(100) = 10
    // critical damping: damping = 2 * sqrt(stiffness * mass) = 2 * 10 = 20
    const s = spring({ keyframes: [0, 100], stiffness: 100, damping: 20, mass: 1 });
    let max = 0;
    for (let t = 0; t < 3000; t += 16) {
      const step = s.next(t);
      max = Math.max(max, step.value);
      if (step.done) break;
    }
    expect(max).toBeLessThanOrEqual(100.0001); // tiny float slop
  });

  it('overdamped springs do not overshoot and approach slowly', () => {
    // dampingRatio > 1
    const s = spring({ keyframes: [0, 100], stiffness: 100, damping: 50, mass: 1 });
    let last = { done: false, value: 0 };
    for (let t = 0; t < 5000; t += 16) {
      last = s.next(t);
      expect(last.value).toBeLessThanOrEqual(100.0001);
      if (last.done) break;
    }
    expect(last.done).toBe(true);
  });

  it('respects custom restDelta to terminate earlier', () => {
    const tight = spring({ keyframes: [0, 100], restDelta: 0.001, restSpeed: 0.001 });
    const loose = spring({ keyframes: [0, 100], restDelta: 5, restSpeed: 5 });

    const stepsTo = (s: ReturnType<typeof spring>): number => {
      for (let t = 0; t < 5000; t += 16) {
        if (s.next(t).done) return t;
      }
      return -1;
    };

    expect(stepsTo(loose)).toBeLessThan(stepsTo(tight));
  });

  it('handles negative deltas (target below origin)', () => {
    const s = spring({ keyframes: [100, 0], stiffness: 200, damping: 20 });
    let last = { done: false, value: 100 };
    for (let t = 0; t < 5000 && !last.done; t += 16) {
      last = s.next(t);
    }
    expect(last.done).toBe(true);
    expect(last.value).toBe(0);
  });

  it('start velocity affects early trajectory', () => {
    const fast = spring({ keyframes: [0, 100], velocity: 500, stiffness: 100, damping: 10 });
    const slow = spring({ keyframes: [0, 100], velocity: 0, stiffness: 100, damping: 10 });
    // At t=50ms, the fast-velocity spring should have moved further toward target.
    const fastAt50 = fast.next(50).value;
    const slowAt50 = slow.next(50).value;
    expect(fastAt50).toBeGreaterThan(slowAt50);
  });
});
