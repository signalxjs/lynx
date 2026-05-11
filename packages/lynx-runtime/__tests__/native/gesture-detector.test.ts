/**
 * Tests for the native gesture detector wrapper — Gesture.* builders,
 * composers, and useGestureDetector op-emit shape.
 *
 * These tests exercise the BG-side machinery in isolation. The MT-side
 * dispatch (ops-apply.ts) is covered separately by lynx-runtime-main tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setCurrentInstance } from '@sigx/runtime-core/internals';

import { OP, takeOps, resetOpQueue } from '../../src/op-queue.js';
import {
  useMainThreadRef,
  resetWvidCounter,
} from '../../src/main-thread-ref.js';
import {
  Gesture,
  GestureType,
  useGestureDetector,
  resetGestureIdCounter,
  type BaseGesture,
} from '../../src/native/gesture-detector.js';

// ---------------------------------------------------------------------------
// Shared fake worklet placeholders — what @lynx-js/react/transform produces
// for `'main thread'` callbacks. The runtime treats _wkltId / _c / _jsFn as
// opaque pointers; tests just need a recognisable shape.
// ---------------------------------------------------------------------------

function fakeWorklet(id: string, captures?: Record<string, unknown>) {
  return captures ? { _wkltId: id, _c: captures } : { _wkltId: id };
}

// ---------------------------------------------------------------------------
// Fake component context — captures onMounted / onUnmounted hooks so tests
// can drive them manually. Mirrors the pattern in main-thread-ref.test.ts.
// ---------------------------------------------------------------------------

function withFakeContext(
  fn: (mount: () => void, unmount: () => void) => void,
) {
  const mountHooks: Array<() => void> = [];
  const unmountHooks: Array<() => void> = [];
  const fakeCtx = {
    onMounted: (cb: () => void) => mountHooks.push(cb),
    onUnmounted: (cb: () => void) => unmountHooks.push(cb),
  } as unknown as Parameters<typeof setCurrentInstance>[0];
  const prev = setCurrentInstance(fakeCtx);
  try {
    fn(
      () => mountHooks.forEach((h) => h()),
      () => unmountHooks.forEach((h) => h()),
    );
  } finally {
    setCurrentInstance(prev);
  }
}

// ---------------------------------------------------------------------------
// Decode a flat op stream into one record per SET_GESTURE_DETECTOR /
// REMOVE_GESTURE_DETECTOR. Skips other ops (INIT_MT_REF etc.) so the
// assertions don't depend on unrelated wire layout.
// ---------------------------------------------------------------------------

interface GestureOpRecord {
  code: number;
  elementWvid: number;
  gestureId: number;
  type?: number;
  config?: {
    callbacks: { name: string; callback: Record<string, unknown> }[];
    config?: Record<string, unknown>;
  };
  relationMap?: { waitFor: number[]; simultaneous: number[]; continueWith: number[] };
}

function pickGestureOps(flat: unknown[]): GestureOpRecord[] {
  const out: GestureOpRecord[] = [];
  let i = 0;
  while (i < flat.length) {
    const code = flat[i++] as number;
    switch (code) {
      case OP.SET_GESTURE_DETECTOR: {
        out.push({
          code,
          elementWvid: flat[i++] as number,
          gestureId: flat[i++] as number,
          type: flat[i++] as number,
          config: flat[i++] as GestureOpRecord['config'],
          relationMap: flat[i++] as GestureOpRecord['relationMap'],
        });
        break;
      }
      case OP.REMOVE_GESTURE_DETECTOR: {
        out.push({
          code,
          elementWvid: flat[i++] as number,
          gestureId: flat[i++] as number,
        });
        break;
      }
      // Skip past known fixed-arity ops we don't care about.
      case OP.INIT_MT_REF:
        i += 2;
        break;
      case OP.RELEASE_MT_REF:
        i += 1;
        break;
      default:
        // Unknown — bail out. Test fixtures shouldn't reach here.
        return out;
    }
  }
  return out;
}

beforeEach(() => {
  resetOpQueue();
  resetWvidCounter();
  resetGestureIdCounter();
});

// ===========================================================================
// Builder shape
// ===========================================================================

describe('Gesture builders', () => {
  it('Pan() produces a BaseGesture with type=PAN and unique id', () => {
    const a = Gesture.Pan().build();
    const b = Gesture.Pan().build();
    expect(a.type).toBe(GestureType.PAN);
    expect(a.__isSerialized).toBe(true);
    expect(a.id).not.toBe(b.id);
    expect(a.callbacks).toEqual({});
    expect(a.waitFor).toEqual([]);
    expect(a.simultaneousWith).toEqual([]);
    expect(a.continueWith).toEqual([]);
  });

  it('Tap/LongPress/Pinch/Rotation/Fling/Native carry their type ids', () => {
    expect(Gesture.Tap().build().type).toBe(GestureType.TAP);
    expect(Gesture.LongPress().build().type).toBe(GestureType.LONGPRESS);
    expect(Gesture.Pinch().build().type).toBe(GestureType.PINCH);
    expect(Gesture.Rotation().build().type).toBe(GestureType.ROTATION);
    expect(Gesture.Fling().build().type).toBe(GestureType.FLING);
    expect(Gesture.Native().build().type).toBe(GestureType.NATIVE);
  });

  it('chainable callback setters write to .callbacks under the right name', () => {
    const onUpdate = fakeWorklet('w-update');
    const onEnd = fakeWorklet('w-end');
    const pan = Gesture.Pan().onUpdate(onUpdate).onEnd(onEnd).build();
    expect(pan.callbacks['onUpdate']).toBe(onUpdate);
    expect(pan.callbacks['onEnd']).toBe(onEnd);
  });

  it('config setters populate the per-type config bag', () => {
    const pan = Gesture.Pan().axis('x').minDistance(8).build();
    expect(pan.config).toEqual({ axis: 'x', minDistance: 8 });

    // The native iOS handler reads `minDuration`, not `duration` — Phase
    // 2.12 fixed `LongPressBuilder.duration()` to set both keys (and added
    // a `.minDuration()` alias). Both keys must be present.
    const lp = Gesture.LongPress().duration(750).maxDistance(10).build();
    expect(lp.config).toEqual({ duration: 750, minDuration: 750, maxDistance: 10 });

    const lpNew = Gesture.LongPress().minDuration(750).maxDistance(10).build();
    expect(lpNew.config).toEqual({ minDuration: 750, maxDistance: 10 });

    const tap = Gesture.Tap().numberOfTaps(2).maxDuration(300).build();
    expect(tap.config).toEqual({ numberOfTaps: 2, maxDuration: 300 });

    const fling = Gesture.Fling().minVelocity(0.5).direction('left').build();
    expect(fling.config).toEqual({ minVelocity: 0.5, direction: 'left' });
  });

  it('relation setters store gesture refs (not just ids) for later id resolution', () => {
    const a = Gesture.Tap().build();
    const b = Gesture.LongPress().build();
    const pan = Gesture.Pan().simultaneousWith(a).waitFor(b).build();
    expect(pan.simultaneousWith).toEqual([a]);
    expect(pan.waitFor).toEqual([b]);
  });
});

// ===========================================================================
// Composers
// ===========================================================================

describe('Gesture composers', () => {
  it('Race() makes sibling bases mutually wait for each other', () => {
    const a = Gesture.Pan();
    const b = Gesture.Tap();
    const composed = Gesture.Race(a, b);
    expect(composed.type).toBe(GestureType.COMPOSED);
    expect(composed.gestures).toHaveLength(2);
    const baseA = a.build();
    const baseB = b.build();
    // Same builder instance — `.build()` returns the cached descriptor.
    expect(baseA.waitFor).toContain(baseB);
    expect(baseB.waitFor).toContain(baseA);
  });

  it('Simultaneous() makes siblings mutually simultaneous', () => {
    const a = Gesture.Pan();
    const b = Gesture.Tap();
    Gesture.Simultaneous(a, b);
    const baseA = a.build();
    const baseB = b.build();
    expect(baseA.simultaneousWith).toContain(baseB);
    expect(baseB.simultaneousWith).toContain(baseA);
  });

  it('Exclusive() makes later items waitFor earlier items only (sequential)', () => {
    const first = Gesture.LongPress();
    const second = Gesture.Tap();
    Gesture.Exclusive(first, second);
    const baseFirst = first.build();
    const baseSecond = second.build();
    expect(baseSecond.waitFor).toContain(baseFirst);
    expect(baseFirst.waitFor).not.toContain(baseSecond);
  });

  it('nested COMPOSED expands to its leaf bases on op-emit', () => {
    // useGestureDetector should walk Race(Simultaneous(a, b), c) → [a, b, c].
    const a = Gesture.Pan().build();
    const b = Gesture.LongPress().build();
    const c = Gesture.Tap().build();
    const composed = Gesture.Race(Gesture.Simultaneous(a, b), c);
    // Verify shape: composed → [composed-inner, c]
    expect(composed.gestures).toHaveLength(2);
    expect((composed.gestures[0] as BaseGesture).type).toBe(GestureType.COMPOSED);
    expect(composed.gestures[1]).toBe(c);
  });
});

// ===========================================================================
// useGestureDetector — op emission
// ===========================================================================

describe('useGestureDetector', () => {
  it('does not emit any op until the component mounts', () => {
    withFakeContext((mount) => {
      const elRef = useMainThreadRef(null);
      // Drain the INIT_MT_REF emitted by useMainThreadRef so the test only
      // sees ops produced by useGestureDetector lifecycle.
      takeOps();

      const pan = Gesture.Pan().onUpdate(fakeWorklet('w-1')).build();
      useGestureDetector(elRef, pan);

      // No ops yet — onMounted has not run.
      expect(pickGestureOps(takeOps())).toEqual([]);

      mount();
      const records = pickGestureOps(takeOps());
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        code: OP.SET_GESTURE_DETECTOR,
        elementWvid: elRef._wvid,
        gestureId: pan.id,
        type: GestureType.PAN,
        relationMap: { waitFor: [], simultaneous: [], continueWith: [] },
      });
    });
  });

  it('serializes callbacks with name+callback shape and stamps _execId', () => {
    withFakeContext((mount) => {
      const elRef = useMainThreadRef(null);
      takeOps();

      const update = fakeWorklet('w-u');
      const end = fakeWorklet('w-e');
      const pan = Gesture.Pan().onUpdate(update).onEnd(end).build();
      useGestureDetector(elRef, pan);
      mount();

      const [op] = pickGestureOps(takeOps());
      expect(op?.config?.callbacks).toHaveLength(2);
      const names = op?.config?.callbacks.map((c) => c.name).sort();
      expect(names).toEqual(['onEnd', 'onUpdate']);
      // registerWorkletCtx stamps _execId on the wire ctx so MT→BG dispatch
      // (runOnBackground inside the gesture callback) routes correctly.
      const wired = op?.config?.callbacks.find((c) => c.name === 'onUpdate');
      expect(wired?.callback['_wkltId']).toBe('w-u');
      expect(typeof wired?.callback['_execId']).toBe('number');
    });
  });

  it('sanitizes MainThreadRef captures inside callback _c to {_wvid, _initValue}', () => {
    withFakeContext((mount) => {
      const elRef = useMainThreadRef(null);
      const tx = useMainThreadRef(0);
      takeOps();

      const cb = fakeWorklet('w-c', { tx });
      const pan = Gesture.Pan().onUpdate(cb).build();
      useGestureDetector(elRef, pan);
      mount();

      const [op] = pickGestureOps(takeOps());
      const captured = op?.config?.callbacks[0]!.callback['_c'] as Record<
        string,
        unknown
      >;
      // Class identity is stripped — only the wire-safe payload survives.
      expect(captured['tx']).toEqual({ _wvid: tx._wvid, _initValue: 0 });
      expect(captured['tx']).not.toBe(tx);
    });
  });

  it('emits relationMap with resolved gesture ids (not gesture refs)', () => {
    withFakeContext((mount) => {
      const elRef = useMainThreadRef(null);
      takeOps();

      const tap = Gesture.Tap().build();
      const lp = Gesture.LongPress().build();
      const pan = Gesture.Pan().simultaneousWith(tap).waitFor(lp).build();
      useGestureDetector(elRef, pan);
      mount();

      const [op] = pickGestureOps(takeOps());
      expect(op?.relationMap).toEqual({
        waitFor: [lp.id],
        simultaneous: [tap.id],
        continueWith: [],
      });
    });
  });

  it('expands COMPOSED gestures into one SET op per base, deduped by id', () => {
    withFakeContext((mount) => {
      const elRef = useMainThreadRef(null);
      takeOps();

      const a = Gesture.Pan().onUpdate(fakeWorklet('w-a')).build();
      const b = Gesture.LongPress().onEnd(fakeWorklet('w-b')).build();
      const composed = Gesture.Race(a, b);
      useGestureDetector(elRef, composed);
      mount();

      const records = pickGestureOps(takeOps());
      expect(records).toHaveLength(2);
      const ids = records.map((r) => r.gestureId).sort();
      expect(ids).toEqual([a.id, b.id].sort());
      // Race wired mutual waitFor — verify it survives to the wire.
      const recA = records.find((r) => r.gestureId === a.id)!;
      const recB = records.find((r) => r.gestureId === b.id)!;
      expect(recA.relationMap?.waitFor).toContain(b.id);
      expect(recB.relationMap?.waitFor).toContain(a.id);
    });
  });

  it('emits REMOVE_GESTURE_DETECTOR for every base on unmount', () => {
    withFakeContext((mount, unmount) => {
      const elRef = useMainThreadRef(null);
      takeOps();

      const a = Gesture.Pan().build();
      const b = Gesture.LongPress().build();
      useGestureDetector(elRef, Gesture.Race(a, b));
      mount();
      takeOps(); // drain the SET ops

      unmount();
      const records = pickGestureOps(takeOps());
      expect(records).toHaveLength(2);
      for (const rec of records) {
        expect(rec.code).toBe(OP.REMOVE_GESTURE_DETECTOR);
        expect(rec.elementWvid).toBe(elRef._wvid);
      }
      const ids = records.map((r) => r.gestureId).sort();
      expect(ids).toEqual([a.id, b.id].sort());
    });
  });

  it('accepts a builder instance directly (without explicit .build())', () => {
    withFakeContext((mount) => {
      const elRef = useMainThreadRef(null);
      takeOps();

      const builder = Gesture.Pan().onUpdate(fakeWorklet('w-b'));
      useGestureDetector(elRef, builder);
      mount();

      const records = pickGestureOps(takeOps());
      expect(records).toHaveLength(1);
      expect(records[0]?.type).toBe(GestureType.PAN);
    });
  });

  it('is a no-op when given a composed gesture with zero bases', () => {
    withFakeContext((mount) => {
      const elRef = useMainThreadRef(null);
      takeOps();

      const empty = Gesture.Race();
      useGestureDetector(elRef, empty);
      mount();

      expect(pickGestureOps(takeOps())).toEqual([]);
    });
  });
});
