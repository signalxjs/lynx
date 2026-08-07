import { onUnmounted } from '@sigx/runtime-core';
import { effect } from '@sigx/reactivity';

import { pushOp, scheduleFlush } from '../op-queue.js';
import { registerBgSink, unregisterBgSink } from '../animated-bridge.js';
import { OP } from '@sigx/lynx-runtime-internal';
import type { DerivedReducerName, DerivedReducerParams } from '@sigx/lynx-runtime-internal';

import { SharedValue } from './shared-value.js';

export type { DerivedReducerName, DerivedReducerParams };

/**
 * A derived `SharedValue`: computed on the MAIN THREAD from one or more
 * source SharedValues via a NAMED reducer, recomputed each flush a source
 * changed. Bind it to a `useAnimatedStyle` like any SV; read `.value` on BG
 * (it publishes like a normal bridged SV).
 *
 * Treat it as READ-ONLY: it is not frozen (writing `.current.value` on the
 * MT is possible), but the derive owns the value — any write is overwritten
 * on the next recompute, so writing it is pointless. Drive it through its
 * sources, not by writing it.
 *
 * The canonical use is composing two motions so an element can sit above
 * **whichever is taller** — a chat composer bar over `max(keyboardLift,
 * sheetHeight)`. Two separate `translateY` bindings would SUM (transforms
 * concatenate); one derived `max` binds correctly.
 *
 * Why a NAMED reducer rather than a `() => Math.max(a.value, b.value)`
 * closure (Reanimated's shape): the recompute runs in the MT flush loop,
 * which is plain MT code — it can't invoke a captured worklet function by
 * value. A name is a primitive the op layer ships trivially, matching the
 * mapper design. Built-ins: `max`, `min`, `sum`, `scale`
 * (`sources[0] * factor + offset`). Register custom reducers on MT via
 * `registerReducer` (from `@sigx/lynx-runtime-main`).
 *
 * @example bar above whichever of keyboard/sheet is taller
 * ```tsx
 * const lift = useDerivedValue([keyboardLift, sheetHeight], 'max');
 * useAnimatedStyle(barRef, lift, 'translateY', { factor: -1 });
 * ```
 *
 * @example a 0..1 progress SV scaled into px
 * ```tsx
 * const px = useDerivedValue([progress], 'scale', { factor: travelPx });
 * ```
 */
/**
 * Options common to both forms.
 */
export interface DerivedValueOptions {
  /**
   * Publish the folded value back to the background thread (default `true`),
   * so `derived.value` is readable and reactive in BG code.
   *
   * Set `false` for a derived value consumed ONLY by main-thread bindings —
   * `useAnimatedStyle`, `useAnimatedMethod`. The BG mirror is not free: every
   * change dispatches an MT→BG event, and a value that changes per frame by
   * construction (a gesture delta, a scroll offset) therefore emits ~60-100
   * dispatches a second for a reader that does not exist. That is enough on
   * its own to trip the engine's dispatch limiter — `ContextProxy::
   * DispatchEvent called too frequently`, error 204 — which surfaces as a red
   * box mid-gesture (#930).
   *
   * With `bridge: false` the SV still exists on the main thread and still
   * folds every frame; only the BG publish is skipped. The BG-side signal is
   * still allocated, so reading `.value` there stays safe — it simply never
   * advances past the initial value.
   */
  bridge?: boolean;
}

export function useDerivedValue<R extends DerivedReducerName>(
  sources: ReadonlyArray<SharedValue<number>>,
  reducer: R,
  params?: DerivedReducerParams[R],
  opts?: DerivedValueOptions,
): SharedValue<number> {
  const bridge = opts?.bridge !== false;
  const derived = new SharedValue<number>(0);
  // The BG sink is bound EITHER WAY: `SharedValue.value` reads through it, so
  // skipping it would make a BG read throw rather than return the initial
  // value. `bridge:false` suppresses the PUBLISH (REGISTER_AV_BRIDGE), not the
  // reader.
  derived._bind(registerBgSink(derived._wvid, 0));

  // The derived SV is itself an auto-flush bridge: INIT creates the MT
  // envelope, REGISTER_AV_BRIDGE arms its write→flush + BG publish. The MT
  // flush writes this envelope; nothing on BG writes it.
  pushOp(OP.INIT_MT_REF, derived._wvid, derived._initValue);
  if (bridge) pushOp(OP.REGISTER_AV_BRIDGE, derived._wvid, 0);
  pushOp(
    OP.REGISTER_AV_DERIVED,
    derived._wvid,
    reducer,
    params ?? null,
    sources.map((s) => s._wvid),
  );
  scheduleFlush();

  onUnmounted(() => {
    pushOp(OP.UNREGISTER_AV_DERIVED, derived._wvid);
    if (bridge) pushOp(OP.UNREGISTER_AV_BRIDGE, derived._wvid);
    pushOp(OP.RELEASE_MT_REF, derived._wvid);
    scheduleFlush();
    unregisterBgSink(derived._wvid);
  });

  return derived;
}

/**
 * Reactive variant: the reducer PARAMS (and/or sources) come from an accessor
 * run in an `effect`, and the derived re-registers on the SAME derived SV
 * whenever they change. Use when a factor is runtime-reactive — e.g. a sheet
 * height whose `travelPx` depends on the active sheet's snap points. The
 * derived SV identity is stable, so consumers bound to it never rebind.
 *
 * Returns the stable derived SV. Passing `null` from the accessor holds the
 * last registration (no-op).
 */
export function useDerivedValueReactive<R extends DerivedReducerName>(
  accessor: () => {
    sources: ReadonlyArray<SharedValue<number>>;
    reducer: R;
    params?: DerivedReducerParams[R];
  } | null,
  opts?: DerivedValueOptions,
): SharedValue<number> {
  const bridge = opts?.bridge !== false;
  const derived = new SharedValue<number>(0);
  // The BG sink is bound EITHER WAY: `SharedValue.value` reads through it, so
  // skipping it would make a BG read throw rather than return the initial
  // value. `bridge:false` suppresses the PUBLISH (REGISTER_AV_BRIDGE), not the
  // reader.
  derived._bind(registerBgSink(derived._wvid, 0));

  pushOp(OP.INIT_MT_REF, derived._wvid, derived._initValue);
  if (bridge) pushOp(OP.REGISTER_AV_BRIDGE, derived._wvid, 0);
  scheduleFlush();

  let sig: string | null = null;
  const runner = effect(() => {
    const cfg = accessor();
    if (!cfg) return;
    const sourceWvids = cfg.sources.map((s) => s._wvid);
    let p = '';
    try {
      p = cfg.params == null ? '' : JSON.stringify(cfg.params);
    } catch {
      p = '';
    }
    const nextSig = `${cfg.reducer}:${p}:${sourceWvids.join(',')}`;
    if (nextSig === sig) return;
    sig = nextSig;
    // Re-register on the SAME derivedWvid — the MT registry replaces the
    // reducer/params/sources while keeping the derived SV (consumers stay
    // bound). Forces a recompute (`computed` resets), so the first flush
    // after a rebind publishes the fresh value.
    pushOp(OP.REGISTER_AV_DERIVED, derived._wvid, cfg.reducer, cfg.params ?? null, sourceWvids);
    scheduleFlush();
  });

  onUnmounted(() => {
    runner.stop();
    pushOp(OP.UNREGISTER_AV_DERIVED, derived._wvid);
    if (bridge) pushOp(OP.UNREGISTER_AV_BRIDGE, derived._wvid);
    pushOp(OP.RELEASE_MT_REF, derived._wvid);
    scheduleFlush();
    unregisterBgSink(derived._wvid);
  });

  return derived;
}
