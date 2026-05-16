import { describe, it, expect } from 'vitest';
import {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  circIn,
  circOut,
  circInOut,
  backIn,
  backOut,
  backInOut,
  anticipate,
  cubicBezier,
  reverseEasing,
  mirrorEasing,
} from '../src/easings.js';

describe('easings — endpoints', () => {
  // Every easing must hit f(0) = 0 and f(1) = 1 to avoid jumps when an
  // animation begins or ends.
  const easings = {
    linear,
    easeIn,
    easeOut,
    easeInOut,
    circIn,
    circOut,
    circInOut,
    backIn,
    backOut,
    backInOut,
    anticipate,
  };

  for (const [name, fn] of Object.entries(easings)) {
    it(`${name}(0) ≈ 0 and ${name}(1) ≈ 1`, () => {
      expect(fn(0)).toBeCloseTo(0, 5);
      // `anticipate` lands at ~0.9995 at p=1 by design (the curve approaches
      // but does not reach 1 due to the exponential tail). Match motion's
      // upstream behavior; we don't try to "fix" it.
      const precision = name === 'anticipate' ? 2 : 5;
      expect(fn(1)).toBeCloseTo(1, precision);
    });
  }
});

describe('easings — monotonicity / character', () => {
  it('linear is the identity', () => {
    expect(linear(0.25)).toBe(0.25);
    expect(linear(0.5)).toBe(0.5);
    expect(linear(0.75)).toBe(0.75);
  });

  it('easeIn starts slow (mid < 0.5)', () => {
    expect(easeIn(0.5)).toBeLessThan(0.5);
  });

  it('easeOut starts fast (mid > 0.5)', () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it('easeInOut is symmetric around 0.5', () => {
    const left = easeInOut(0.3);
    const right = 1 - easeInOut(0.7);
    expect(left).toBeCloseTo(right, 4);
  });

  it('backOut overshoots past 1', () => {
    // backOut peaks above 1.0 somewhere in (0.5, 1) before settling at 1.
    let maxValue = 0;
    for (let p = 0; p <= 1; p += 0.01) {
      maxValue = Math.max(maxValue, backOut(p));
    }
    expect(maxValue).toBeGreaterThan(1);
  });

  it('circIn is concave (slow start, fast end)', () => {
    expect(circIn(0.5)).toBeLessThan(0.5);
  });
});

describe('cubicBezier', () => {
  it('returns identity for the linear curve (0,0,1,1)', () => {
    const fn = cubicBezier(0, 0, 1, 1);
    expect(fn(0.25)).toBeCloseTo(0.25, 4);
    expect(fn(0.5)).toBeCloseTo(0.5, 4);
  });

  it('matches easeOut shape for known control points', () => {
    const fn = cubicBezier(0, 0, 0.58, 1);
    // Sanity: at t=0.5, easeOut should be > 0.5.
    expect(fn(0.5)).toBeGreaterThan(0.5);
    // Reference values from a standalone bezier-easing implementation.
    expect(fn(0.25)).toBeCloseTo(0.4, 1);
    expect(fn(0.75)).toBeCloseTo(0.86, 1);
  });
});

describe('modifiers', () => {
  it('reverseEasing turns easeIn into easeOut', () => {
    const reversed = reverseEasing(easeIn);
    // At p=0.25, easeOut should be larger than easeIn (mirror across diagonal).
    expect(reversed(0.25)).toBeGreaterThan(easeIn(0.25));
    expect(reversed(0)).toBeCloseTo(0, 5);
    expect(reversed(1)).toBeCloseTo(1, 5);
  });

  it('mirrorEasing produces a symmetric curve', () => {
    const mirrored = mirrorEasing(easeIn);
    expect(mirrored(0.25)).toBeCloseTo(1 - mirrored(0.75), 5);
  });
});
