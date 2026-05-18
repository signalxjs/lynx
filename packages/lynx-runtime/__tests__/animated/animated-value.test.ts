/**
 * Back-compat smoke tests for the deprecated `AnimatedValue` / `useAnimatedValue`
 * / `AnimatedValueState` aliases. The full behavior is exercised in
 * `shared-value.test.ts`; this file just pins that the deprecated import path
 * still resolves and behaves identically.
 *
 * Remove when the deprecation cycle ends.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { resetOpQueue } from '../../src/op-queue';
import { resetWvidCounter } from '../../src/main-thread-ref';
import { resetBgAvBridge } from '../../src/animated-bridge';
import {
  useAnimatedValue,
  AnimatedValue,
} from '../../src/animated/animated-value';
import { SharedValue } from '../../src/animated/shared-value';

beforeEach(() => {
  resetOpQueue();
  resetBgAvBridge();
  resetWvidCounter();
});

describe('back-compat: AnimatedValue / useAnimatedValue', () => {
  it('useAnimatedValue still allocates a value', () => {
    const av = useAnimatedValue(7);
    expect(av.current.value).toBe(7);
    expect(av.value).toBe(7);
  });

  it('AnimatedValue is the same constructor as SharedValue', () => {
    expect(AnimatedValue).toBe(SharedValue);
    const av = useAnimatedValue(0);
    expect(av).toBeInstanceOf(SharedValue);
    expect(av).toBeInstanceOf(AnimatedValue);
  });
});
