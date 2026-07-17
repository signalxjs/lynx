import { onUnmounted } from '@sigx/runtime-core';
import { effect } from '@sigx/reactivity';

import { pushOp, scheduleFlush } from '../op-queue.js';
import { registerBgSink, unregisterBgSink } from '../animated-bridge.js';
import { OP } from '@sigx/lynx-runtime-internal';
import type { DerivedReducerName, DerivedReducerParams } from '@sigx/lynx-runtime-internal';

import { SharedValue } from './shared-value.js';

export type { DerivedReducerName, DerivedReducerParams };

/**
 * A read-only derived `SharedValue`: computed on the MAIN THREAD from one or
 * more source SharedValues via a NAMED reducer, recomputed each flush a
 * source changed. Bind it to a `useAnimatedStyle` like any SV; read `.value`
 * on BG (it publishes like a normal bridged SV).
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
export function useDerivedValue<R extends DerivedReducerName>(
  sources: ReadonlyArray<SharedValue<number>>,
  reducer: R,
  params?: DerivedReducerParams[R],
): SharedValue<number> {
  const derived = new SharedValue<number>(0);
  derived._bind(registerBgSink(derived._wvid, 0));

  // The derived SV is itself an auto-flush bridge: INIT creates the MT
  // envelope, REGISTER_AV_BRIDGE arms its write→flush + BG publish. The MT
  // flush writes this envelope; nothing on BG writes it.
  pushOp(OP.INIT_MT_REF, derived._wvid, derived._initValue);
  pushOp(OP.REGISTER_AV_BRIDGE, derived._wvid, 0);
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
    pushOp(OP.UNREGISTER_AV_BRIDGE, derived._wvid);
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
): SharedValue<number> {
  const derived = new SharedValue<number>(0);
  derived._bind(registerBgSink(derived._wvid, 0));

  pushOp(OP.INIT_MT_REF, derived._wvid, derived._initValue);
  pushOp(OP.REGISTER_AV_BRIDGE, derived._wvid, 0);
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
    pushOp(OP.UNREGISTER_AV_BRIDGE, derived._wvid);
    pushOp(OP.RELEASE_MT_REF, derived._wvid);
    scheduleFlush();
    unregisterBgSink(derived._wvid);
  });

  return derived;
}
