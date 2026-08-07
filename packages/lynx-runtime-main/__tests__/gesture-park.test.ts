/**
 * A gesture registration that arrives before its element is bound must be
 * parked and replayed, not dropped (#958).
 *
 * `useGestureDetector` pushes `SET_GESTURE_DETECTOR` from `onMounted`, and the
 * element is bound by `SET_MT_REF`. Normally the ref op comes first. It does
 * not when the detector's owner mounts EARLIER than the element it binds to —
 * a screen that measures itself before rendering its content does exactly
 * that. Dropping the op there was silent and permanent: nothing threw, the
 * batch was well-formed, and the gesture was simply dead forever.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import { applyOps, resetMainThreadState } from '../src/ops-apply';
import { elements } from '../src/element-registry';
import { parkedGestureCount } from '../src/gesture-park';

/** Gesture ids installed via `__SetGestureDetector`, in call order. */
let installed: number[];

beforeEach(() => {
  resetMainThreadState();
  installed = [];
  vi.stubGlobal('__FlushElementTree', () => {});
  // Presence of this global is what selects the native arena path.
  // Signature: (dom, gestureId, type, config, relationMap).
  vi.stubGlobal('__SetGestureDetector', (_dom: unknown, gestureId: number) => {
    installed.push(gestureId);
  });
  vi.stubGlobal('__SetAttribute', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMainThreadState();
});

/** A SET_GESTURE_DETECTOR op targeting `wvid`. */
function setGesture(wvid: number, gestureId: number, relations?: {
  waitFor?: number[];
  simultaneous?: number[];
  continueWith?: number[];
}): unknown[] {
  return [
    OP.SET_GESTURE_DETECTOR,
    wvid,
    gestureId,
    0,
    { callbacks: [] },
    {
      waitFor: relations?.waitFor ?? [],
      simultaneous: relations?.simultaneous ?? [],
      continueWith: relations?.continueWith ?? [],
    },
  ];
}

describe('registration arriving before the element binds', () => {
  it('parks instead of dropping', () => {
    applyOps(setGesture(5, 1));

    expect(installed).toHaveLength(0);
    expect(parkedGestureCount()).toBe(1);
  });

  it('applies it the moment the element binds', () => {
    applyOps(setGesture(5, 1));
    expect(installed).toHaveLength(0);

    elements.set(100, { __brand: 'el100' } as never);
    applyOps([OP.SET_MT_REF, 100, 5]);

    expect(installed).toHaveLength(1);
    expect(parkedGestureCount()).toBe(0);
  });

  it('replays a composed gesture in arrival order', () => {
    // Relations reference siblings by id, so replaying out of order would
    // rebuild a different arena.
    applyOps([
      ...setGesture(5, 10),
      ...setGesture(5, 11, { waitFor: [10] }),
      ...setGesture(5, 12, { simultaneous: [10, 11] }),
    ]);
    expect(parkedGestureCount()).toBe(3);

    elements.set(100, { __brand: 'el100' } as never);
    applyOps([OP.SET_MT_REF, 100, 5]);

    expect(installed).toEqual([10, 11, 12]);
  });

  it('keeps parked registrations separate per element', () => {
    applyOps([...setGesture(5, 1), ...setGesture(6, 2)]);
    expect(parkedGestureCount()).toBe(2);

    elements.set(100, { __brand: 'el100' } as never);
    applyOps([OP.SET_MT_REF, 100, 5]);

    expect(installed).toHaveLength(1);
    // The other element's registration is still waiting for its own bind.
    expect(parkedGestureCount()).toBe(1);
  });

  it('does not park when the element is already bound', () => {
    elements.set(100, { __brand: 'el100' } as never);
    applyOps([OP.SET_MT_REF, 100, 5]);
    applyOps(setGesture(5, 1));

    expect(installed).toHaveLength(1);
    expect(parkedGestureCount()).toBe(0);
  });

  it('keeps the operand cursor aligned, so the rest of the batch still applies', () => {
    // The park path consumes exactly the same operands as the apply path.
    elements.set(200, { __brand: 'el200' } as never);
    const styles: unknown[] = [];
    vi.stubGlobal('__SetInlineStyles', (_el: unknown, v: unknown) => styles.push(v));

    applyOps([
      ...setGesture(5, 1), // unresolved → parked
      OP.SET_STYLE, 200, { width: '10px' },
    ]);

    expect(parkedGestureCount()).toBe(1);
    expect(styles).toEqual([{ width: '10px' }]);
  });
});

describe('removal while still parked', () => {
  it('forgets the parked registration', () => {
    // A detector whose owner unmounts inside the parking window emits its
    // REMOVE while the SET is still waiting.
    applyOps(setGesture(5, 1));
    applyOps([OP.REMOVE_GESTURE_DETECTOR, 5, 1]);

    expect(parkedGestureCount()).toBe(0);

    elements.set(100, { __brand: 'el100' } as never);
    applyOps([OP.SET_MT_REF, 100, 5]);

    // Nothing installs for a component that no longer exists.
    expect(installed).toHaveLength(0);
  });

  it('removes only the named gesture from a parked group', () => {
    applyOps([...setGesture(5, 10), ...setGesture(5, 11)]);
    applyOps([OP.REMOVE_GESTURE_DETECTOR, 5, 10]);
    expect(parkedGestureCount()).toBe(1);

    elements.set(100, { __brand: 'el100' } as never);
    applyOps([OP.SET_MT_REF, 100, 5]);

    expect(installed).toEqual([11]);
  });
});

describe('lifecycle', () => {
  it('a bind with nothing parked is a no-op', () => {
    elements.set(100, { __brand: 'el100' } as never);
    expect(() => applyOps([OP.SET_MT_REF, 100, 5])).not.toThrow();
    expect(installed).toHaveLength(0);
  });

  it('binding twice does not install the same registration again', () => {
    applyOps(setGesture(5, 1));
    elements.set(100, { __brand: 'el100' } as never);
    applyOps([OP.SET_MT_REF, 100, 5]);
    applyOps([OP.SET_MT_REF, 100, 5]);

    expect(installed).toHaveLength(1);
  });

  it('resetMainThreadState clears the park', () => {
    applyOps(setGesture(5, 1));
    expect(parkedGestureCount()).toBe(1);

    resetMainThreadState();
    expect(parkedGestureCount()).toBe(0);
  });
});

describe('web host', () => {
  it('parks on web too, and registers the recognizer on bind', () => {
    // Web has no gesture PAPI; the MT-side recognizer takes over. It needs the
    // element just as much, so it must park the same way.
    vi.stubGlobal('__SetGestureDetector', undefined);

    applyOps(setGesture(5, 1));
    expect(parkedGestureCount()).toBe(1);

    const el = { addEventListener: vi.fn(), removeEventListener: vi.fn(), style: {} };
    elements.set(100, el as never);
    applyOps([OP.SET_MT_REF, 100, 5]);

    expect(parkedGestureCount()).toBe(0);
    // The web recognizer attaches pointer listeners on registration.
    expect(el.addEventListener).toHaveBeenCalled();
  });
});
