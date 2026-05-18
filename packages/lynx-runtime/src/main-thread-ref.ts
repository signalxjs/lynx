/**
 * MainThreadRef — a ref whose `.current` value lives on the Main Thread.
 *
 * On the Background Thread, `.current` is always the initial value (typically
 * `null`). On the Main Thread, `.current` is set to the real Lynx element
 * handle when the ref is bound via `main-thread:ref={ref}`.
 *
 * This is the sigx equivalent of react-lynx's `useMainThreadRef()` and
 * vue-lynx's `useMainThreadRef()`. It enables zero-latency style updates
 * and animations by giving main-thread event handlers synchronous access
 * to native elements.
 *
 * Architecture:
 *   BG: useMainThreadRef(init) → MainThreadRef { wvid, current: init }
 *        → pushOp(INIT_MT_REF, wvid, init)
 *   BG: patchProp('main-thread:ref', ref) → pushOp(SET_MT_REF, elId, wvid)
 *   MT: INIT_MT_REF → workletRefs.set(wvid, { current: init })
 *   MT: SET_MT_REF  → workletRefs.get(wvid).current = elements.get(elId)
 */

import { onUnmounted } from '@sigx/runtime-core';
import { OP, pushOp, scheduleFlush } from './op-queue';

// ---------------------------------------------------------------------------
// Worklet variable ID generator
// ---------------------------------------------------------------------------

let nextWvid = 1;

export function resetWvidCounter(): void {
  nextWvid = 1;
}

// ---------------------------------------------------------------------------
// MainThreadRef class
// ---------------------------------------------------------------------------

/**
 * A ref whose `.current` property is managed on the Main Thread.
 *
 * On the BG thread, `.current` returns the `initValue` and is read-only
 * (setting it has no effect — the real value lives on MT).
 *
 * In main-thread event handlers and `runOnMainThread` callbacks, `.current`
 * is the real Lynx element handle with methods like `setStyleProperties()`,
 * `getComputedStyleProperty()`, and `animate()`.
 */
export class MainThreadRef<T = unknown> {
  /**
   * Worklet variable ID — uniquely identifies this ref across threads.
   * Underscored to match the field name `transformWorklet` walks for
   * in @lynx-js/react/worklet-runtime when expanding `_c` captures.
   */
  readonly _wvid: number;

  /**
   * Initial value snapshot — sent to MT in INIT_MT_REF and used by
   * the worklet-runtime to seed the firstScreen ref map.
   */
  readonly _initValue: T;

  /**
   * On BG: the init value (read-only snapshot).
   * On MT: the real element handle (set by SET_MT_REF op).
   */
  current: T;

  constructor(initValue: T) {
    this._wvid = nextWvid++;
    this._initValue = initValue;
    this.current = initValue;
  }
}

/**
 * Walk a captured `_c` map and serialize MainThreadRef instances to plain
 * `{ _wvid, _initValue }` objects so they survive the JSON round-trip across
 * the BG→MT bridge. Upstream's worklet-runtime walks `_c` looking for `_wvid`
 * to recognize ref captures and resolve them via
 * `lynxWorkletImpl._refImpl._workletRefMap`.
 *
 * Used by both the SET_WORKLET_EVENT path (`nodeOps.patchProp`) and the
 * SET_GESTURE_DETECTOR path (`native/gesture-detector.ts`).
 */
export function sanitizeCaptured(
  captured: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in captured) {
    const v = captured[k];
    if (v instanceof MainThreadRef) {
      out[k] = { _wvid: v._wvid, _initValue: v._initValue };
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// useMainThreadRef composable
// ---------------------------------------------------------------------------

/**
 * Create a ref that provides synchronous access to a native element on the
 * Main Thread. Bind it to an element via `main-thread:ref={ref}`.
 *
 * @example
 * ```tsx
 * const elRef = useMainThreadRef<MainThread.Element>(null);
 *
 * function handleScroll(e: ScrollEvent) {
 *   'main thread';
 *   const offset = e.detail.scrollTop;
 *   elRef.current?.setStyleProperties({
 *     transform: `translateY(${-offset}px)`,
 *   });
 * }
 *
 * return (
 *   <scroll-view
 *     main-thread-bindscroll={handleScroll}
 *   >
 *     <view main-thread:ref={elRef}>
 *       <text>Sticky header</text>
 *     </view>
 *   </scroll-view>
 * );
 * ```
 */
export function useMainThreadRef<T = unknown>(
  initValue: T,
): MainThreadRef<T> {
  const ref = new MainThreadRef<T>(initValue);
  // Tell the MT to create a worklet ref holder with this ID and initial value.
  pushOp(OP.INIT_MT_REF, ref._wvid, initValue);
  scheduleFlush();
  // Release the holder when the owning component unmounts. Without this, the
  // MT-side `_workletRefMap` grows monotonically across mount/unmount cycles
  // (router-driven apps with frequent navigation hit this fastest).
  // `onUnmounted` no-ops if called outside a component setup; callers that
  // construct refs ad-hoc (e.g. tests) just won't get a release op, which is
  // the same as today's behaviour.
  onUnmounted(() => {
    pushOp(OP.RELEASE_MT_REF, ref._wvid);
    scheduleFlush();
  });
  return ref;
}
