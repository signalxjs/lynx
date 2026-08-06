/**
 * MT-side SharedValue bridge — publishes MT-thread mutations to BG.
 *
 * Diffs every registered SharedValue against its last-published snapshot
 * and dispatches one batched `Lynx.Sigx.AvPublish` event per flush boundary
 * with the changed `[wvid, value]` tuples. The BG side ingests these via
 * `@sigx/lynx-runtime/src/animated-bridge.ts` and writes them into the
 * mirror signal so any sigx `effect` reading `sv.value` re-runs.
 *
 * Bridge state (`bridgedAvWvids` / `bridgedAvLastValues`) lives in
 * `ops-apply.ts` because the BG→MT op handlers mutate it; this module
 * imports the references and reads them on every flush.
 *
 * Three flush hook points:
 *   1. `ops-apply.ts` calls `flushAvBridgePublishes()` at its tail (covers
 *      every BG-driven ops batch).
 *   2. `installAvBridgeFlushHook()` wraps `globalThis.__FlushElementTree`
 *      so spontaneous MT writes (e.g. a touchmove worklet that eventually
 *      calls `setStyleProperties`) also trigger a publish on the same
 *      tick the native tree flushes. Called once from `entry-main.ts`
 *      after PAPI globals are present.
 *   3. `armAvAutoFlush()` (below) makes the SharedValue envelope itself
 *      schedule a flush on every write, so a worklet that ONLY writes
 *      `sv.current.value` — no style call, no manual flush — still repaints
 *      the same frame. Installed per-wvid by the `OP.REGISTER_AV_BRIDGE`
 *      handler.
 *
 * Coalescing: `===` per-wvid diff. Identical writes are filtered. N writes
 * within one flush window collapse to one BG event with N entries.
 */

import {
  bridgedAvWvids,
  bridgedAvLastValues,
  resolveElementByWvid,
} from './ops-apply.js';
import { lookupMapper } from './animated-style-mappers.js';
import { flushDerivedValues } from './derived-values-mt.js';

const AV_PUBLISH = 'Lynx.Sigx.AvPublish';

interface AvRef {
  current: { value?: unknown };
  _wvid: number;
}

interface WorkletImpl {
  _refImpl?: {
    _workletRefMap: Record<number, AvRef>;
  };
}

interface JSContextLike {
  dispatchEvent?: (e: { type: string; data: string }) => void;
}

interface LynxLike {
  getJSContext?: () => JSContextLike;
}

/**
 * Diff registered AVs against their last-published snapshots; dispatch one
 * batched `Lynx.Sigx.AvPublish` event with all changed tuples. No-op when
 * the bridge set is empty or when nothing has changed since the last call.
 */
export function flushAvBridgePublishes(): void {
  if (bridgedAvWvids.size === 0) return;

  const impl = (globalThis as { lynxWorkletImpl?: WorkletImpl }).lynxWorkletImpl;
  const refMap = impl?._refImpl?._workletRefMap;
  if (!refMap) return;

  let updates: Array<[number, unknown]> | undefined;
  for (const wvid of bridgedAvWvids) {
    const ref = refMap[wvid];
    if (!ref) continue;
    const v = ref.current?.value;
    if (v !== bridgedAvLastValues.get(wvid)) {
      (updates ??= []).push([wvid, v]);
      bridgedAvLastValues.set(wvid, v);
    }
  }

  if (!updates) return;

  const lynxObj = (globalThis as { lynx?: LynxLike }).lynx;
  const ctx = lynxObj?.getJSContext?.();
  if (!ctx?.dispatchEvent) return;

  let data: string;
  try {
    data = JSON.stringify(updates);
  } catch (e) {
    console.log('[sigx-mt] av-bridge: JSON.stringify failed:', String(e));
    return;
  }

  ctx.dispatchEvent({ type: AV_PUBLISH, data });
}

// ---------------------------------------------------------------------------
// useAnimatedStyle bindings
//
// Each registered binding maps a SharedValue -> a partial style object
// applied to a bound element on every flush where the SharedValue's value
// changed. The MT side never sees the user's mapper code directly — the BG
// ops carry only the mapper's *name*, which the MT runtime resolves via
// lookupMapper().
// ---------------------------------------------------------------------------

interface AnimatedStyleBinding {
  elementWvid: number;
  avWvid: number;
  mapperName: string;
  params: unknown;
  lastValue: unknown;
}

const animatedStyleBindings = new Map<number, AnimatedStyleBinding>();

/**
 * Register a binding (called from the OP.REGISTER_AV_STYLE_BINDING op
 * handler in `ops-apply.ts`). Initializes `lastValue` to a sentinel so the
 * first flush always applies the mapper, even when the AV is at its initial.
 */
export function registerAnimatedStyleBinding(
  bindingId: number,
  elementWvid: number,
  avWvid: number,
  mapperName: string,
  params: unknown,
): void {
  // Sentinel — guaranteed not to equal any user value, so the first flush
  // applies the mapper regardless of whether the AV ever gets written.
  const sentinel = {} as unknown;
  animatedStyleBindings.set(bindingId, {
    elementWvid,
    avWvid,
    mapperName,
    params,
    lastValue: sentinel,
  });
}

export function unregisterAnimatedStyleBinding(bindingId: number): void {
  animatedStyleBindings.delete(bindingId);
}

export function resetAnimatedStyleBindings(): void {
  animatedStyleBindings.clear();
}

export function animatedStyleBindingCount(): number {
  return animatedStyleBindings.size;
}

interface ElementWithStyleApply {
  setStyleProperties?: (styles: Record<string, string | number>) => void;
}

/** `translateY(…)` → `translateY`, `translate3d(…)` → `translate3d`, … —
 * function names can contain digits (`translate3d`, `rotate3d`, `matrix3d`). */
const TRANSFORM_FN_RE = /([a-zA-Z][a-zA-Z0-9]*)\s*\(/g;
const warnedDupTransform = new Set<number>();

/**
 * Dev-only guard for the concatenation footgun: two bindings on one element
 * that both emit the SAME transform function (e.g. two `translateY`) SUM,
 * silently. That is occasionally intended (stacking offsets) but far more
 * often a mistake — the caller wanted `max`/one-of, which is what
 * `useDerivedValue` is for (#710). Warn ONCE per element; production
 * (`NODE_ENV === 'production'`) stays silent and cost-free.
 */
function warnOnDuplicateTransformFn(elementWvid: number, existing: string, incoming: string): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.['NODE_ENV'];
  if (env === 'production') return;
  if (warnedDupTransform.has(elementWvid)) return;
  const have = new Set<string>();
  let m: RegExpExecArray | null;
  TRANSFORM_FN_RE.lastIndex = 0;
  while ((m = TRANSFORM_FN_RE.exec(existing)) !== null) have.add(m[1]!);
  TRANSFORM_FN_RE.lastIndex = 0;
  while ((m = TRANSFORM_FN_RE.exec(incoming)) !== null) {
    if (have.has(m[1]!)) {
      warnedDupTransform.add(elementWvid);
      console.warn(
        `[sigx] Two animated-style bindings on one element both emit ` +
        `\`${m[1]}(…)\` — they CONCATENATE, so the values SUM. If you meant ` +
        `"whichever is larger/one-of", combine the SharedValues with ` +
        `useDerivedValue([...], 'max') and bind the single result instead.`,
      );
      return;
    }
  }
}

/** Reset hook (tests) — re-arm the once-per-element dup-transform warning. */
export function resetDuplicateTransformWarnings(): void {
  warnedDupTransform.clear();
}

/**
 * For each element with at least one *dirty* binding (AV value changed since
 * the last apply), re-run **all** of that element's bindings, merge their
 * mapper outputs, and apply the result with a single `setStyleProperties`
 * call. Called from the wrapped `__FlushElementTree` *before* the native
 * tree flush.
 *
 * Why "all bindings on a dirty element" rather than "only changed bindings":
 *   - Multiple bindings on the same element can write the same style key
 *     (e.g. `translateX` + `translateY` both produce `transform`). If we
 *     applied only the changed ones, the unchanged-binding's contribution
 *     would be lost and the element would visibly snap. By re-running every
 *     binding on the dirty element and merging, all contributions land in
 *     the same `setStyleProperties` call.
 *
 * Merge semantics:
 *   - `transform` values from multiple bindings *concatenate* in registration
 *     order (e.g. `translateX(50px)` + `translateY(20px)` ->
 *     `translateX(50px) translateY(20px)`).
 *   - All other keys merge by last-write-wins; a binding registered later on
 *     the same element overwrites an earlier binding's same-key output.
 *
 * Skip cases (silent, by design):
 *   - AV ref missing in `_workletRefMap` (race with unregister).
 *   - Element ref's `current` is null (component not yet mounted, or
 *     unmounted before the binding's UNREGISTER op landed).
 *   - Mapper name not registered (typo or missing custom registration).
 */
export function flushAnimatedStyleBindings(): void {
  if (animatedStyleBindings.size === 0) return;

  const impl = (globalThis as { lynxWorkletImpl?: WorkletImpl }).lynxWorkletImpl;
  const refMap = impl?._refImpl?._workletRefMap;
  if (!refMap) return;

  // Phase 1 — find which elements have at least one dirty binding. Update
  // each binding's lastValue so the next flush only re-applies on further
  // change. Skip bindings whose AV ref is missing.
  let dirtyElements: Set<number> | undefined;
  for (const binding of animatedStyleBindings.values()) {
    const avRef = refMap[binding.avWvid];
    if (!avRef) continue;
    const v = avRef.current?.value;
    if (v === binding.lastValue) continue;
    binding.lastValue = v;
    (dirtyElements ??= new Set()).add(binding.elementWvid);
  }
  if (!dirtyElements) return;

  // Phase 2 — for each dirty element, run *all* its bindings and merge the
  // outputs into one style object. Iteration order over the Map is insertion
  // order, which equals registration order — so transform concatenations
  // come out in the order the user registered them.
  const merged = new Map<number, Record<string, string | number>>();
  for (const binding of animatedStyleBindings.values()) {
    if (!dirtyElements.has(binding.elementWvid)) continue;

    const avRef = refMap[binding.avWvid];
    if (!avRef) continue;
    const v = avRef.current?.value;

    const mapper = lookupMapper(binding.mapperName);
    if (!mapper) continue;

    let out: Record<string, string | number>;
    try {
      out = mapper(v, binding.params);
    } catch (e) {
      console.log('[sigx-mt] av-style mapper threw:', binding.mapperName, String(e));
      continue;
    }

    let acc = merged.get(binding.elementWvid);
    if (!acc) {
      acc = {};
      merged.set(binding.elementWvid, acc);
    }
    for (const k in out) {
      if (k === 'transform' && typeof acc.transform === 'string') {
        warnOnDuplicateTransformFn(binding.elementWvid, acc.transform, String(out.transform));
        acc.transform = `${acc.transform} ${String(out.transform)}`;
      } else {
        acc[k] = out[k]!;
      }
    }
  }

  // Phase 3 — apply the merged style per dirty element.
  for (const [elementWvid, styleObj] of merged) {
    const elRef = refMap[elementWvid];
    const el = elRef?.current as unknown as ElementWithStyleApply | null | undefined;

    // Preferred path (native): the worklet-ref wrapper's `setStyleProperties`
    // applies via the platform's optimized per-frame worklet write.
    if (el?.setStyleProperties) {
      try {
        el.setStyleProperties(styleObj);
        continue;
      } catch {
        // Wrapper apply failed — notably web (`@lynx-js/web-core`), where the
        // wrapper's `setStyleProperties` → `setProperty` isn't implemented for
        // the underlying element. Fall through to the raw PAPI below so
        // animations still run instead of silently freezing.
      }
    }

    // Fallback: apply directly on the unwrapped MainThreadElement via
    // `__SetInlineStyles` — the same PAPI the `SET_STYLE` op uses, which works
    // on web. The surrounding `__FlushElementTree` commits it. Resolves
    // wvid → elementId → element from the shared registry. On native this
    // never runs (the wrapper path above succeeds).
    const rawEl = resolveElementByWvid(elementWvid);
    if (rawEl && typeof __SetInlineStyles === 'function') {
      try {
        __SetInlineStyles(rawEl, styleObj);
      } catch (e) {
        console.log('[sigx-mt] av-style raw apply threw:', String(e));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// useAnimatedMethod bindings (#844)
//
// Each registered binding maps a SharedValue -> a native UI-method invoke on
// a bound element: on every flush where the SV's value changed, invoke
// `methodName` with `{...params, [valueKey]: value}`. The imperative sibling
// of the style bindings above, for natively-backed per-frame state a style
// write can't express without a layout pass (e.g. <list> setBottomInset).
// ---------------------------------------------------------------------------

interface AnimatedMethodBinding {
  elementWvid: number;
  avWvid: number;
  methodName: string;
  valueKey: string;
  params: unknown;
  lastValue: unknown;
}

const animatedMethodBindings = new Map<number, AnimatedMethodBinding>();

/**
 * Register a method binding (called from the OP.REGISTER_AV_METHOD_BINDING
 * handler in `ops-apply.ts`). `lastValue` starts at a sentinel so the first
 * flush always invokes, even when the AV never gets written past its initial.
 */
export function registerAnimatedMethodBinding(
  bindingId: number,
  elementWvid: number,
  avWvid: number,
  methodName: string,
  valueKey: string,
  params: unknown,
): void {
  const sentinel = {} as unknown;
  animatedMethodBindings.set(bindingId, {
    elementWvid,
    avWvid,
    methodName,
    valueKey,
    params,
    lastValue: sentinel,
  });
}

export function unregisterAnimatedMethodBinding(bindingId: number): void {
  animatedMethodBindings.delete(bindingId);
}

export function resetAnimatedMethodBindings(): void {
  animatedMethodBindings.clear();
}

export function animatedMethodBindingCount(): number {
  return animatedMethodBindings.size;
}

/**
 * The two wrapper shapes a `main-thread:ref` can hold, both of which carry the
 * raw platform element we need for `__InvokeUIMethod`.
 *
 * On **web / worklet-refs** it is our own `MTElementWrapper`, which stores it
 * as `_el`. On **native** `bindMtRef` hands the element to upstream's
 * `updateWorkletRef`, which wraps it in `@lynx-js/react`'s own `Element` —
 * whose handle is called `element` (see `upstream-invoke-patch.ts`, which
 * patches that class for the same reason). Reading only `_el` therefore missed
 * every native binding and the method was never invoked (#930) — the same
 * our-wrapper-vs-upstream-Element trap as #863.
 */
interface ElementWithRaw {
  /** Our `MTElementWrapper` (web / worklet-refs path). */
  _el?: unknown;
  /** Upstream `@lynx-js/react` `Element` (native `main-thread:ref` path). */
  element?: unknown;
}

/**
 * For each binding whose AV value changed since the last apply, invoke the
 * bound element's UI method with the fresh value. Called from the wrapped
 * `__FlushElementTree` AFTER `flushAnimatedStyleBindings()` (and therefore
 * after derived values folded — a binding to a derived SV sees the fresh
 * fold the same frame).
 *
 * Two deliberate deviations from the style-binding flush:
 *
 *  - **Keep-dirty on unresolved element**: `lastValue` is NOT updated when
 *    the element ref hasn't resolved (not yet mounted) or the invoke threw —
 *    a producer like the keyboard lift can settle once and never write
 *    again, and a dropped apply would strand the native state forever.
 *    Style bindings tolerate the drop because the next SV write re-applies.
 *
 *  - **Raw PAPI invoke**: `__InvokeUIMethod` on the unwrapped element, not
 *    `MTElementWrapper.invoke` — the wrapper schedules its own extra flush
 *    and we are already inside one (see Draggable's edge-scroll: "invoke()
 *    already flushes — don't double-flush"). Fire-and-forget callback;
 *    hosts that don't know the method degrade to a no-op.
 */
export function flushAnimatedMethodBindings(): void {
  if (animatedMethodBindings.size === 0) return;
  if (typeof __InvokeUIMethod !== 'function') return;

  const impl = (globalThis as { lynxWorkletImpl?: WorkletImpl }).lynxWorkletImpl;
  const refMap = impl?._refImpl?._workletRefMap;
  if (!refMap) return;

  for (const binding of animatedMethodBindings.values()) {
    const avRef = refMap[binding.avWvid];
    if (!avRef) continue;
    const v = avRef.current?.value;
    if (v === binding.lastValue) continue;

    // Resolve the element: prefer the worklet-ref wrapper's raw element
    // (`main-thread:ref` path), fall back to the shared element registry.
    const wrapped = refMap[binding.elementWvid]?.current as ElementWithRaw | null | undefined;
    const el = wrapped?._el ?? wrapped?.element ?? resolveElementByWvid(binding.elementWvid);
    if (!el) continue; // stay dirty — apply on a later flush once mounted

    const params: Record<string, unknown> = { ...(binding.params as Record<string, unknown> | null) };
    // defineProperty, not assignment — `valueKey` is caller-controlled and a
    // key like `__proto__` would otherwise hit the prototype setter (same
    // guard as mt-invoke.ts uses when copying arbitrary keys).
    Object.defineProperty(params, binding.valueKey, {
      value: v,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    try {
      // Optimistic: mark applied, then UNDO if native reports a failure. A
      // native REJECTION is not the same as a throw and must also keep the
      // binding dirty — the common case is `NO_UI_FOR_NODE` (6): the element
      // node exists and its ref resolves, but the platform UI behind it is
      // still being created (Android creates list UIs asynchronously). Those
      // early flushes used to be counted as delivered, so a producer that then
      // settled and never wrote again — a numeric `bottomInset`, a keyboard
      // lift that reaches its rest value — stranded the native state forever
      // (#930). Restoring the sentinel makes the next flush retry.
      // The callback may run EITHER synchronously (native answers inline —
      // the ordering trap behind #863) or later. Handle both: the flag covers
      // the sync case, where assigning `lastValue` below would otherwise
      // overwrite the undo; the `lastValue` check covers the async case.
      const attempted = v;
      let failedInline = false;
      __InvokeUIMethod(el as MainThreadElement, binding.methodName, params, (res: unknown) => {
        const code = (res as { code?: number } | null | undefined)?.code;
        if (code === undefined || code === 0) return;
        failedInline = true;
        // Only un-apply OUR attempt: a newer value may already have landed.
        if (binding.lastValue === attempted) binding.lastValue = {} as unknown;
      });
      if (!failedInline) binding.lastValue = v;
    } catch {
      // Sync throw (teardown / layout transition) — stay dirty and retry on
      // the next flush rather than stranding the native state.
    }
  }
}

const INSTALLED = Symbol.for('sigx.avBridgeFlushHookInstalled');

/**
 * Wrap `globalThis.__FlushElementTree` once so every flush also runs the AV
 * bridge publish step. Idempotent — safe to call across hot reloads. Test
 * setups that `vi.stubGlobal('__FlushElementTree', ...)` AFTER this hook
 * installs will replace our wrapper, which is the correct behavior for
 * unit tests that drive `flushAvBridgePublishes` directly.
 */
export function installAvBridgeFlushHook(): void {
  const g = globalThis as Record<string | symbol, unknown>;
  if (g[INSTALLED]) return;
  const original = g['__FlushElementTree'];
  if (typeof original !== 'function') return;
  g[INSTALLED] = true;
  g['__FlushElementTree'] = function wrappedFlushElementTree(
    this: unknown,
    ...args: unknown[]
  ): unknown {
    // Derived values recompute FIRST so a style binding (or BG publish) that
    // reads a derived SV this same flush sees the fresh, folded value (#710).
    try {
      flushDerivedValues();
    } catch (e) {
      console.log('[sigx-mt] av-derived flush threw:', String(e));
    }
    try {
      flushAvBridgePublishes();
    } catch (e) {
      console.log('[sigx-mt] av-bridge flush threw:', String(e));
    }
    try {
      flushAnimatedStyleBindings();
    } catch (e) {
      console.log('[sigx-mt] av-style bindings flush threw:', String(e));
    }
    try {
      flushAnimatedMethodBindings();
    } catch (e) {
      console.log('[sigx-mt] av-method bindings flush threw:', String(e));
    }
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  };
}

// ---------------------------------------------------------------------------
// SharedValue auto-flush
//
// Historically, a bare MT write `sv.current.value = x` was a plain property
// mutation: bindings applied and the BG publish happened only when something
// ELSE flushed the element tree. Every finger-following gesture component
// had to remember an inline `__FlushElementTree()` in its onUpdate worklet —
// and the ones that forgot (navigation's sheet drag / edge-back swipe) only
// repainted on incidental flushes, lagging the finger. Arming the envelope
// with a setter removes the failure mode by construction.
// ---------------------------------------------------------------------------

/**
 * Microtask-coalesced `__FlushElementTree()` trigger. Deliberately shares
 * lynx-motion `animate()`'s latch flag (`__sigxMotionFlushScheduled`,
 * animate.ts): a motion tick writes the SV (setter schedules, sets the
 * latch) and then calls its own flush trigger (sees the latch, bails) —
 * ONE flush per microtask window, never two. `__FlushElementTree` is read
 * at fire time so the microtask gets the AV-bridge-wrapped version that
 * applies bindings and publishes before the native tree flush.
 */
function scheduleAvFlush(): void {
  const g = globalThis as Record<string, unknown>;
  if (g['__sigxMotionFlushScheduled']) return;
  g['__sigxMotionFlushScheduled'] = true;
  Promise.resolve().then(() => {
    g['__sigxMotionFlushScheduled'] = false;
    const fn = g['__FlushElementTree'];
    if (typeof fn !== 'function') return;
    try {
      (fn as () => void)();
    } catch (e) {
      // Swallow-and-log: a throw here would surface as an unhandled
      // rejection on MT with no useful stack.
      console.log('[sigx-mt] av auto-flush threw:', String(e));
    }
  });
}

/**
 * Arm auto-flush on a registered SharedValue: convert the MT envelope's
 * `value` data property into a get/set pair whose setter schedules a
 * coalesced flush after storing the write.
 *
 * The accessor is defined on the EXISTING envelope object (identity
 * preserved) because worklet captures resolve `{_wvid}` to the same entry
 * via upstream's `getFromWorkletRefMap` — past and future captures all see
 * the setter. Safe against upstream: its worklet runtime only creates
 * ref-map entries if missing (`updateWorkletRefInitValueChanges`) and only
 * reassigns `.current` for element refs (`main-thread:ref` path), never for
 * SharedValue envelopes.
 *
 * Bails silently — preserving the old boundary-driven behavior — when the
 * envelope is missing (register raced release), isn't an object, `value`
 * is already an accessor (double-register), or `defineProperty` refuses.
 */
export function armAvAutoFlush(wvid: number): void {
  const impl = (globalThis as { lynxWorkletImpl?: WorkletImpl }).lynxWorkletImpl;
  const env = impl?._refImpl?._workletRefMap?.[wvid]?.current;
  if (!env || typeof env !== 'object') return;
  const desc = Object.getOwnPropertyDescriptor(env, 'value');
  if (!desc || desc.get || desc.set) return;
  let backing = desc.value as unknown;
  try {
    Object.defineProperty(env, 'value', {
      get: () => backing,
      set: (v: unknown) => {
        backing = v;
        scheduleAvFlush();
      },
      enumerable: true,
      configurable: true,
    });
  } catch {
    // Frozen/sealed/exotic envelope — leave the data property in place.
  }
}
