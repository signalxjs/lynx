/**
 * MT-side worklet invocation — shared by the `sigxRunOnMT` bridge global
 * (entry-main.ts) and the `INVOKE_WORKLET` op handler (ops-apply.ts, #688).
 *
 * Dispatches ride the ordered `sigxPatchUpdate` ops stream (see
 * `runOnMainThread` in lynx-runtime/threading.ts): a dispatch enqueued after
 * a mount's SET_MT_REF / INIT_MT_REF / registration ops applies after them
 * by construction. The legacy `sigxRunOnMT` callLepusMethod channel is kept
 * for direct-from-test callers; both funnel here.
 */

import { invokeWorklet } from './worklet-events.js';

/**
 * Deep-clone a value into a fresh tree whose every object has
 * `Object.prototype`.
 *
 * Why: PrimJS's `JSON.parse` produces null-prototype objects (a prototype-
 * pollution safety measure that V8 / SpiderMonkey don't apply). Upstream's
 * worklet runtime (`@lynx-js/react@0.121+`'s `workletRuntime.js`) walks
 * the captured `_c`, identifies worklet placeholders by `'_wkltId' in
 * subObj`, and then calls `new WeakRef(subObj)`. PrimJS's `WeakRef` rejects
 * null-prototype objects with `TypeError: WeakRef: target must be an
 * object`, so the worklet body never runs.
 *
 * `Object.setPrototypeOf` is a silent no-op on PrimJS's JSON.parse output
 * (the proto slot is locked even with `isExtensible: true`), so the only
 * way to get an `Object.prototype`-prototyped object is to rebuild it via
 * `{}` literal. A fresh object literal always has `Object.prototype` by
 * spec, so deep-cloning the captured tree produces a fully WeakRef-able
 * shape that's semantically identical for the worklet body.
 *
 * JSON.parse output is acyclic by construction, so no cycle detection
 * needed. Arrays handled separately to keep `Array.isArray` true downstream.
 */
export function rebuildWithObjectPrototype<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map(rebuildWithObjectPrototype) as unknown as T;
  }
  // Use `Object.defineProperty` (not `out[k] = ...`) so a `__proto__` key in
  // the captured payload doesn't trigger the prototype setter on `out` and
  // re-null the prototype we just gave it. Belt-and-braces against accidental
  // prototype pollution; in practice `_c` is shaped by `sanitizeCaptured` on
  // BG and shouldn't carry `__proto__`, but the guarantee is cheap.
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    Object.defineProperty(out, k, {
      value: rebuildWithObjectPrototype((value as Record<string, unknown>)[k]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out as unknown as T;
}

/**
 * Invoke the registered `'main thread'` worklet `wkltId`. When `captured`
 * is supplied, route through upstream's `runWorklet({_wkltId, _c}, args)`
 * so its `I()` walker hydrates the placeholders inside `_c` (resolves
 * nested `{_wkltId}` worklet refs to callable functions and `{_wvid}` ref
 * placeholders to live MainThreadRefs from `_workletRefMap`). This matches
 * the path SET_WORKLET_EVENT uses for JSX-attached MT handlers.
 *
 * `invokeWorklet` is the fallback for the `captured === undefined` case
 * (no captures to hydrate) and for direct-from-MT callers that already
 * hand over a hydrated ctx.
 */
export function invokeMtWorklet(
  wkltId: string,
  args: unknown[] | undefined,
  captured: Record<string, unknown> | undefined,
): unknown {
  const argsArr = args ?? [];
  const runWorkletFn = (globalThis as Record<string, unknown>)['runWorklet'] as
    | ((placeholder: { _wkltId: string; _c?: Record<string, unknown> }, args: unknown[]) => unknown)
    | undefined;
  if (captured && typeof runWorkletFn === 'function') {
    const fixedCaptured = rebuildWithObjectPrototype(captured);
    try {
      return runWorkletFn({ _wkltId: wkltId, _c: fixedCaptured }, argsArr);
    } catch (e) {
      console.log('[sigx-mt] MT worklet threw:', String(e), 'wkltId=', wkltId);
      return undefined;
    }
  }
  return invokeWorklet(wkltId, captured, argsArr);
}
