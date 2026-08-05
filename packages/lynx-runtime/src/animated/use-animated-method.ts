import { onUnmounted } from '@sigx/runtime-core';
import { effect } from '@sigx/reactivity';

import { pushOp, scheduleFlush } from '../op-queue.js';
import type { MainThreadRef } from '../main-thread-ref.js';
import type { MainThread } from '../jsx.js';
import { OP } from '@sigx/lynx-runtime-internal';

import type { SharedValue } from './shared-value.js';

let nextBindingId = 1;

/** Reset hook for tests. */
export function resetAnimatedMethodBindingIds(): void {
  nextBindingId = 1;
}

function allocBindingId(): number {
  return nextBindingId++;
}

/**
 * Reactive binding spec — what an accessor returns to describe the method
 * binding that should currently be live, or `null` for "no binding right now".
 */
export interface AnimatedMethodSpec {
  sv: SharedValue<unknown>;
  /** Native UI method to invoke on the bound element (e.g. `setBottomInset`). */
  methodName: string;
  /** Param key the SharedValue's value is written under. Default: `value`. */
  valueKey?: string;
  /** Static params merged into every invoke (the SV value wins on collision). */
  params?: Record<string, unknown>;
}

/**
 * Stable identity for a spec so the reactive binder can tell "same binding,
 * different object instance" (no-op) from "actually changed" (rebind).
 */
function specSignature(cfg: AnimatedMethodSpec | null): string {
  if (!cfg) return 'none';
  let p = '';
  try {
    p = cfg.params == null ? '' : JSON.stringify(cfg.params);
  } catch {
    p = '';
  }
  return `${cfg.methodName}:${cfg.sv._wvid}:${cfg.valueKey ?? 'value'}:${p}`;
}

/**
 * Bind a `MainThreadRef`'s element to a `SharedValue` via a native **UI
 * method**: on every flush boundary where the SharedValue's value changed, the
 * MT runtime invokes `methodName` on the element with
 * `{ ...params, [valueKey]: value }` — no thread crossing per frame.
 *
 * This is the imperative sibling of `useAnimatedStyle`, for natively-backed
 * per-frame state that a style write can't express without a layout pass —
 * e.g. `<list>`'s `setBottomInset` (#844), where the platform recycler adjusts
 * its viewport inset directly. The invoke happens inside the same flush pass
 * as style bindings and AFTER derived values fold, so binding a
 * `useDerivedValue` result sees the fresh folded value the same frame.
 *
 * Unlike style bindings (which tolerate a dropped frame — the next SV write
 * re-applies), a method binding stays dirty while its element is unmounted or
 * unresolved and applies on a later flush: a producer like the keyboard lift
 * can settle once and never write again, and the value must not strand.
 *
 * Failures are fire-and-forget: an element whose host widget doesn't know the
 * method degrades to a no-op (e.g. web hosts without the native subclass).
 *
 * Two call shapes, mirroring `useAnimatedStyle`:
 *
 *  - **Static** `useAnimatedMethod(ref, sv, methodName, opts)` — registers
 *    once at setup, unregisters at unmount.
 *
 *  - **Reactive** `useAnimatedMethod(ref, () => spec | null)` — runs the
 *    accessor in an `effect` and (re)binds when the returned spec's signature
 *    changes, or unbinds on `null`. Use when the SharedValue only becomes
 *    available after mount (e.g. a bottom sheet hands out its reveal SV via a
 *    callback prop on first render).
 *
 * @example List bottom inset driven by a sheet's reveal
 * ```tsx
 * useAnimatedMethod(listRef, () =>
 *   revealSV.value
 *     ? { sv: revealSV.value, methodName: 'setBottomInset',
 *         valueKey: 'inset', params: { pin: true } }
 *     : null,
 * );
 * ```
 */
export function useAnimatedMethod(
  elRef: MainThreadRef<MainThread.Element | null>,
  sv: SharedValue<unknown>,
  methodName: string,
  opts?: { valueKey?: string; params?: Record<string, unknown> },
): void;
export function useAnimatedMethod(
  elRef: MainThreadRef<MainThread.Element | null>,
  spec: () => AnimatedMethodSpec | null,
): void;
export function useAnimatedMethod(
  elRef: MainThreadRef<MainThread.Element | null>,
  svOrSpec: SharedValue<unknown> | (() => AnimatedMethodSpec | null),
  methodName?: string,
  opts?: { valueKey?: string; params?: Record<string, unknown> },
): void {
  // Reactive form: drive register/unregister from an effect on the accessor.
  if (typeof svOrSpec === 'function') {
    bindReactiveAnimatedMethod(elRef, svOrSpec);
    return;
  }

  // Static form: register once, unregister at unmount.
  const sv = svOrSpec;
  const bindingId = allocBindingId();

  pushOp(
    OP.REGISTER_AV_METHOD_BINDING,
    bindingId,
    elRef._wvid,
    sv._wvid,
    methodName,
    opts?.valueKey ?? 'value',
    opts?.params ?? null,
  );
  scheduleFlush();

  onUnmounted(() => {
    pushOp(OP.UNREGISTER_AV_METHOD_BINDING, bindingId);
    scheduleFlush();
  });
}

/**
 * Reactive-binding implementation — same shape and ordering discipline as
 * `bindReactiveAnimatedStyle`: signature-deduped rebinds against the same
 * element, `scheduleFlush()` (never `flushNow()`) so REGISTER ops ride the
 * ordered channel, full unregister on unmount.
 */
function bindReactiveAnimatedMethod(
  elRef: MainThreadRef<MainThread.Element | null>,
  accessor: () => AnimatedMethodSpec | null,
): void {
  let bindingId: number | null = null;
  let sig: string | null = null;

  const runner = effect(() => {
    const cfg = accessor();
    const nextSig = specSignature(cfg);
    if (nextSig === sig) return;
    sig = nextSig;

    if (bindingId !== null) {
      pushOp(OP.UNREGISTER_AV_METHOD_BINDING, bindingId);
      bindingId = null;
    }
    if (cfg) {
      const id = allocBindingId();
      bindingId = id;
      pushOp(
        OP.REGISTER_AV_METHOD_BINDING,
        id,
        elRef._wvid,
        cfg.sv._wvid,
        cfg.methodName,
        cfg.valueKey ?? 'value',
        cfg.params ?? null,
      );
    }
    scheduleFlush();
  });

  onUnmounted(() => {
    runner.stop();
    if (bindingId !== null) {
      pushOp(OP.UNREGISTER_AV_METHOD_BINDING, bindingId);
      bindingId = null;
      scheduleFlush();
    }
  });
}
