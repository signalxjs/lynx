import { onUnmounted } from '@sigx/runtime-core';
import type { PrimitiveSignal } from '@sigx/reactivity';

import { MainThreadRef } from '../main-thread-ref.js';
import { pushOp, scheduleFlush } from '../op-queue.js';
import { registerBgSink, unregisterBgSink } from '../animated-bridge.js';
import { OP } from '@sigx/lynx-runtime-internal';

/**
 * Internal envelope shape stored under `MainThreadRef.current`. Wrapping the
 * value in `{ value: T }` (rather than a bare `T`) lets MT worklets mutate
 * the value without breaking ref identity, and leaves room to extend with
 * derived state later (e.g. velocity) without changing the public type.
 */
export interface SharedValueState<T> {
  value: T;
}

/**
 * MT-writeable, BG-readable cross-thread value with sigx reactive tracking.
 *
 * **Not animation-specific.** Animation is one customer (see `@sigx/motion`),
 * gestures is another (`<Draggable translateX={sv} />`), scroll is another
 * (`useScrollViewOffset`). Anywhere fast-or-frequent state lives natively on
 * MT and you want BG to observe it reactively, this is the primitive.
 *
 * **MT side** — inside `'main thread'` worklets, mutate via `sv.current.value
 * = newValue`. The MainThreadRef machinery makes the mutation stick across
 * worklet invocations on the same wvid. Writes auto-schedule a
 * (microtask-coalesced) `__FlushElementTree`: the MT runtime arms a setter
 * on the envelope at `REGISTER_AV_BRIDGE` time (`animated-bridge-mt.ts:
 * armAvAutoFlush`), so `useAnimatedStyle` bindings apply and the BG publish
 * lands the same frame — no manual flush needed in gesture worklets.
 *
 * **BG side** — read via `sv.value` to get the latest published snapshot.
 * Sigx tracking applies, so an `effect(() => console.log(sv.value))` re-runs
 * whenever an MT publish ingests a new value. Writes from BG are read-only;
 * dev-mode warns to point users back at the MT path.
 *
 * The class extends `MainThreadRef<{value:T}>` so that BG-side serialization
 * (`nodeOps.ts:sanitizeCaptured`) recognizes it as a worklet ref and ships
 * `{_wvid, _initValue}` over the wire to the MT bundle.
 *
 * @example
 * ```tsx
 * const tx = useSharedValue(0);
 *
 * <Draggable translateX={tx} />
 * <text>x = {tx.value}</text>   // BG-reactive, updates per drag frame
 * ```
 */
export class SharedValue<T = number> extends MainThreadRef<SharedValueState<T>> {
  /** @internal — populated by `useSharedValue`. Reads here back the BG signal. */
  private _bgSignal!: PrimitiveSignal<T>;

  constructor(initial: T) {
    super({ value: initial });
  }

  /** @internal */
  _bind(sig: PrimitiveSignal<T>): void {
    this._bgSignal = sig;
  }

  /**
   * BG-side reactive read. Returns the latest snapshot published by the MT
   * bridge (or the initial value before any publish has occurred).
   */
  get value(): T {
    return this._bgSignal.value as T;
  }

  set value(_v: T) {
    // Reach for process via globalThis so the package doesn't pull in
    // @types/node just for a dev-mode warning. NODE_ENV defaults to a
    // non-production string, so the warning fires unless the bundler has
    // explicitly substituted it to 'production'.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.['NODE_ENV'];
    if (env !== 'production') {
      console.warn(
        '[sigx] SharedValue.value is read-only on the BG thread. ' +
        'Mutate via the MT worklet (sv.current.value = v).',
      );
    }
  }
}

/**
 * Allocate a `SharedValue<T>` whose MT-side mutations are observable on the
 * BG thread via sigx reactivity. Bind it to a component prop or read its
 * `.value` from a BG `effect`.
 *
 * Lifecycle:
 *   - On allocate: pushes `INIT_MT_REF` (creates the MT-side refMap holder)
 *     and `REGISTER_AV_BRIDGE` (tells MT to track this wvid in its diff/
 *     publish pass). Allocates a BG-side signal mirror keyed by wvid.
 *   - On the owning component's unmount: pushes `UNREGISTER_AV_BRIDGE` and
 *     `RELEASE_MT_REF`, drops the BG signal.
 */
export function useSharedValue<T = number>(initial: T): SharedValue<T> {
  const sv = new SharedValue<T>(initial);

  // BG: register the signal mirror under the wvid allocated in super().
  sv._bind(registerBgSink(sv._wvid, initial));

  // MT: create the refMap entry (envelope shape) and begin tracking this
  // wvid in the diff/publish pass.
  pushOp(OP.INIT_MT_REF, sv._wvid, sv._initValue);
  pushOp(OP.REGISTER_AV_BRIDGE, sv._wvid, initial);
  scheduleFlush();

  onUnmounted(() => {
    pushOp(OP.UNREGISTER_AV_BRIDGE, sv._wvid);
    pushOp(OP.RELEASE_MT_REF, sv._wvid);
    scheduleFlush();
    unregisterBgSink(sv._wvid);
  });

  return sv;
}
