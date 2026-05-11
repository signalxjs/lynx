/**
 * BG-side SharedValue bridge — receives MT-thread publishes.
 *
 * Maintains a `wvid → signal<T>` registry. The MT-side bridge in
 * `@sigx/lynx-runtime-main/animated-bridge-mt.ts` dispatches batched
 * `Lynx.Sigx.AvPublish` events with `[wvid, value]` tuples; `bg-bridge.ts`
 * routes them through `ingestAvPublishes()` here, which writes each new
 * value into the corresponding signal. Sigx reactivity tracking then re-runs
 * any `effect` that read `sv.value` on BG.
 *
 * Producer: the `useSharedValue` hook in `@sigx/lynx` allocates the
 * BG-side signal via `registerBgSink(wvid, initial)` and tears it down via
 * `unregisterBgSink(wvid)` on component unmount.
 *
 * Naming note: the wire-format ops (`REGISTER_AV_BRIDGE`, `UNREGISTER_AV_BRIDGE`,
 * `Lynx.Sigx.AvPublish`) keep their original `Av` prefix as infrastructure
 * constants. The user-facing primitive renamed from `AnimatedValue` to
 * `SharedValue` in Phase 2.8.
 */

import { signal, type PrimitiveSignal } from '@sigx/reactivity';

const bgRegistry = new Map<number, PrimitiveSignal<unknown>>();

/**
 * Allocate a BG-side signal mirror for the given wvid. Returns the signal so
 * the caller can read it via `.value` — sigx tracking applies as usual.
 *
 * Idempotent on the wvid: if a signal is already registered, returns the
 * existing one without resetting its value (avoids losing in-flight publishes
 * during HMR-triggered re-registration).
 */
export function registerBgSink<T>(wvid: number, initial: T): PrimitiveSignal<T> {
  const existing = bgRegistry.get(wvid);
  if (existing) return existing as unknown as PrimitiveSignal<T>;
  // sigx's `signal` has Primitive vs object overloads; SharedValues hold
  // primitives in practice (numbers, strings) and the bridge only ever
  // writes through `.value`, so a single-overload selection via cast keeps
  // the unconstrained T usable here without forcing SharedValue consumers
  // to type-narrow at every call site.
  const s = signal(initial as unknown as number);
  bgRegistry.set(wvid, s as unknown as PrimitiveSignal<unknown>);
  return s as unknown as PrimitiveSignal<T>;
}

/**
 * Drop the BG-side signal for this wvid. Called on component unmount.
 * Subsequent `ingestPublish` entries for this wvid become no-ops.
 */
export function unregisterBgSink(wvid: number): void {
  bgRegistry.delete(wvid);
}

/**
 * Ingest a batch of `[wvid, value]` tuples from the MT bridge. Writes each
 * into the corresponding signal so any `effect` that read it re-runs on the
 * sigx scheduler's next tick. Tuples for unregistered wvids (race with
 * unmount) are silently dropped.
 */
export function ingestAvPublishes(updates: Array<[number, unknown]>): void {
  for (const [wvid, value] of updates) {
    const s = bgRegistry.get(wvid);
    if (!s) continue;
    (s as unknown as { value: unknown }).value = value;
  }
}

/** Reset hook — for testing. Drops every registered sink. */
export function resetBgAvBridge(): void {
  bgRegistry.clear();
}

/** Test hook — number of currently registered sinks. */
export function bgAvSinkCount(): number {
  return bgRegistry.size;
}
