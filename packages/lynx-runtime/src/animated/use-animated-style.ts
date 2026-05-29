import { onUnmounted } from '@sigx/runtime-core';
import { effect } from '@sigx/reactivity';

import { pushOp, scheduleFlush } from '../op-queue.js';
import type { MainThreadRef } from '../main-thread-ref.js';
import type { MainThread } from '../jsx.js';
import { OP } from '@sigx/lynx-runtime-internal';
import type { BuiltinMapperName, MapperParams } from '@sigx/lynx-runtime-internal';

import type { SharedValue } from './shared-value.js';

// Re-export the public types so users can write
//   import type { BuiltinMapperName } from '@sigx/lynx'
// without reaching into lynx-runtime-internal directly.
export type { BuiltinMapperName, MapperParams };

let nextBindingId = 1;

/** Reset hook for tests. */
export function resetAnimatedStyleBindingIds(): void {
  nextBindingId = 1;
}

/**
 * Returns the next binding id without incrementing — internal helper used by
 * the `useAnimatedStyle` overloads to share allocation. Not exported.
 */
function allocBindingId(): number {
  return nextBindingId++;
}

/**
 * Reactive binding spec — the `{ sv, mapperName, params }` triple an accessor
 * returns to describe the binding that should currently be live, or `null`
 * for "no binding right now".
 */
export interface AnimatedStyleSpec {
  sv: SharedValue<unknown>;
  mapperName: BuiltinMapperName;
  params?: MapperParams[BuiltinMapperName];
}

/**
 * Stable identity for a spec so the reactive binder can tell "same binding,
 * different object instance" (no-op) from "actually changed" (rebind). The
 * SharedValue's `_wvid` plus the mapper name + JSON-serialized params uniquely
 * pin the binding the MT side would register.
 */
function specSignature(cfg: AnimatedStyleSpec | null): string {
  if (!cfg) return 'none';
  let p = '';
  try {
    p = cfg.params == null ? '' : JSON.stringify(cfg.params);
  } catch {
    p = '';
  }
  return `${cfg.mapperName}:${cfg.sv._wvid}:${p}`;
}

/**
 * Bind a `MainThreadRef`'s element style to a `SharedValue` via a named
 * mapper. The MT-side runtime applies the mapper's output via
 * `setStyleProperties` on every flush boundary where the SharedValue's value changed.
 *
 * The mapper runs on the **Main Thread** with no thread crossing per frame —
 * the only inputs are the SharedValue's value (already on MT) and the `params` shipped
 * once in the registration op. Because mappers are looked up by *name*, the
 * SWC worklet transform doesn't have to capture a function reference (which
 * it can't), so this fits the existing worklet pipeline cleanly.
 *
 * Multiple bindings on the same element compose into a single
 * `setStyleProperties` call per flush. `transform` outputs concatenate in
 * registration order (e.g. `translateX(50px) translateY(20px)`); other style
 * keys merge by last-write-wins. When ANY binding on an element is dirty,
 * ALL of that element's bindings re-run so partial outputs don't drop the
 * unchanged-axis contribution.
 *
 * Two call shapes:
 *
 *  - **Static** `useAnimatedStyle(ref, sv, mapperName, params)` — registers the
 *    binding once at setup and unregisters at unmount. Use this when the
 *    binding never changes for the element's lifetime (the common case:
 *    Draggable, Swipeable, drawer offsets, …).
 *
 *  - **Reactive** `useAnimatedStyle(ref, () => spec | null)` — runs the
 *    accessor in an `effect` and (re)binds whenever the returned spec changes,
 *    or unbinds when it returns `null`. The binding always targets the *same*
 *    element, so the host element (and its subtree) stays mounted across
 *    rebinds. Use this when a single element transitions between animation
 *    states at runtime — e.g. a navigator layer that animates during a
 *    transition then settles to a static rest position. Re-binding on the
 *    same element is what lets `<Stack>` avoid remounting screens per
 *    animation phase (see `lynx-navigation`'s `<Layer>`).
 *
 * @example Ghost follower at 0.5× (static)
 * ```tsx
 * const tx = useSharedValue(0);
 * const ghostRef = useMainThreadRef<MainThread.Element | null>(null);
 *
 * useAnimatedStyle(ghostRef, tx, 'translateX', { factor: 0.5 });
 *
 * <Draggable translateX={tx} />
 * <view main-thread:ref={ghostRef} style={...} />
 * ```
 *
 * @example Animate-then-rest, no remount (reactive)
 * ```tsx
 * useAnimatedStyle(ref, () =>
 *   props.animation
 *     ? { sv: props.animation.progress, mapperName: props.animation.axis,
 *         params: { inputRange: [...], outputRange: [...] } }
 *     : null,
 * );
 * ```
 */
export function useAnimatedStyle<N extends BuiltinMapperName>(
  elRef: MainThreadRef<MainThread.Element | null>,
  sv: SharedValue<unknown>,
  mapperName: N,
  params?: MapperParams[N],
): void;
export function useAnimatedStyle(
  elRef: MainThreadRef<MainThread.Element | null>,
  spec: () => AnimatedStyleSpec | null,
): void;
export function useAnimatedStyle(
  elRef: MainThreadRef<MainThread.Element | null>,
  svOrSpec: SharedValue<unknown> | (() => AnimatedStyleSpec | null),
  mapperName?: BuiltinMapperName,
  params?: MapperParams[BuiltinMapperName],
): void {
  // Reactive form: drive register/unregister from an effect on the accessor.
  if (typeof svOrSpec === 'function') {
    bindReactiveAnimatedStyle(elRef, svOrSpec);
    return;
  }

  // Static form (unchanged): register once, unregister at unmount.
  const sv = svOrSpec;
  const bindingId = allocBindingId();

  pushOp(
    OP.REGISTER_AV_STYLE_BINDING,
    bindingId,
    elRef._wvid,
    sv._wvid,
    mapperName,
    params ?? null,
  );
  scheduleFlush();

  onUnmounted(() => {
    pushOp(OP.UNREGISTER_AV_STYLE_BINDING, bindingId);
    scheduleFlush();
  });
}

/**
 * Reactive-binding implementation. Runs `accessor` in an `effect`; when the
 * resulting spec's *signature* changes, unregisters the previous binding (if
 * any) and registers the new one against the same element. A `null` spec means
 * "no binding right now" — the element keeps the last style the MT applied
 * (mappers are not reset on unregister), which for transition transforms is the
 * resting identity transform.
 *
 * The signature dedupe is load-bearing: callers typically build a *fresh* spec
 * object on every render (e.g. `computeLayers` in `<Stack>`), so the accessor's
 * return value changes identity every render even when the logical binding is
 * unchanged. Without the dedupe the binding would thrash register/unregister on
 * every progress-driven re-render.
 *
 * Ordering note: we `scheduleFlush()` (microtask-deferred), never `flushNow()`,
 * so the REGISTER op lands on the same channel and ordering the static form
 * uses — preserving the "bindings register → SV resets inside the worklet →
 * withTiming starts" sequence the navigator relies on.
 */
function bindReactiveAnimatedStyle(
  elRef: MainThreadRef<MainThread.Element | null>,
  accessor: () => AnimatedStyleSpec | null,
): void {
  let bindingId: number | null = null;
  let sig: string | null = null;

  const runner = effect(() => {
    const cfg = accessor();
    const nextSig = specSignature(cfg);
    if (nextSig === sig) return;
    sig = nextSig;

    if (bindingId !== null) {
      pushOp(OP.UNREGISTER_AV_STYLE_BINDING, bindingId);
      bindingId = null;
    }
    if (cfg) {
      const id = allocBindingId();
      bindingId = id;
      pushOp(
        OP.REGISTER_AV_STYLE_BINDING,
        id,
        elRef._wvid,
        cfg.sv._wvid,
        cfg.mapperName,
        cfg.params ?? null,
      );
    }
    scheduleFlush();
  });

  onUnmounted(() => {
    runner.stop();
    if (bindingId !== null) {
      pushOp(OP.UNREGISTER_AV_STYLE_BINDING, bindingId);
      bindingId = null;
      scheduleFlush();
    }
  });
}
