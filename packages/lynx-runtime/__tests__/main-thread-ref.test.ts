/**
 * Tests for useMainThreadRef lifecycle.
 *
 * Verifies that creating a MainThreadRef pushes INIT_MT_REF and that the
 * unmount path pushes RELEASE_MT_REF — without this release op, the MT-side
 * `lynxWorkletImpl._refImpl._workletRefMap` grows monotonically across
 * router-driven navigation (visible-but-slow memory leak).
 *
 * The lifecycle hook (`onUnmounted`) is wired through @sigx/runtime-core's
 * component setup. Outside a component context onUnmounted is a no-op.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { OP, takeOps, resetOpQueue } from '../src/op-queue.js';
import {
  useMainThreadRef,
  resetWvidCounter,
} from '../src/main-thread-ref.js';
import { setCurrentInstance } from '@sigx/runtime-core/internals';

beforeEach(() => {
  resetOpQueue();
  resetWvidCounter();
});

describe('useMainThreadRef', () => {
  it('pushes INIT_MT_REF with the wvid and init value at creation', () => {
    useMainThreadRef('hello');
    const ops = takeOps();
    expect(ops.slice(0, 3)).toEqual([OP.INIT_MT_REF, 1, 'hello']);
  });

  it('does not throw when called outside a component context (onUnmounted no-ops)', () => {
    expect(() => useMainThreadRef(42)).not.toThrow();
  });

  it('pushes RELEASE_MT_REF when the simulated unmount hook runs', () => {
    // Simulate a component context: install a fake instance whose
    // onUnmounted captures the registered cleanup. We then invoke that
    // cleanup to assert the RELEASE_MT_REF op is queued.
    const unmountHooks: Array<() => void> = [];
    const fakeCtx = {
      onUnmounted: (fn: () => void) => unmountHooks.push(fn),
    } as unknown as Parameters<typeof setCurrentInstance>[0];

    const prev = setCurrentInstance(fakeCtx);
    try {
      useMainThreadRef('y');
    } finally {
      setCurrentInstance(prev);
    }

    // INIT_MT_REF queued at construction.
    expect(takeOps().slice(0, 3)).toEqual([OP.INIT_MT_REF, 1, 'y']);

    // Drive the unmount hook.
    expect(unmountHooks).toHaveLength(1);
    unmountHooks[0]!();

    // RELEASE_MT_REF queued.
    expect(takeOps().slice(0, 2)).toEqual([OP.RELEASE_MT_REF, 1]);
  });
});
