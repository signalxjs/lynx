/**
 * Compat shim for upstream's worklet `Element.prototype.invoke` (#863).
 *
 * `@lynx-js/react`'s worklet runtime
 * (`runtime/lib/worklet-runtime/api/element.js`) implements `invoke` as:
 *
 * ```js
 * return new Promise((resolve, reject) => {
 *   __InvokeUIMethod(this.element, methodName, params ?? {}, (res) => {
 *     if (res.code === 0) resolve(res.data);
 *     else reject(new Error('UI method invoke: ' + JSON.stringify(res)));
 *   });
 *   this.flushElementTree();
 * });
 * ```
 *
 * `__InvokeUIMethod` answers **synchronously** for the everyday native "no"
 * cases — a duplicate scroll while one is animating
 * (`{code: 1, data: "dumplicated, scrollToPositionSmoothly is working"}`), a
 * stale element, an out-of-range index. So the promise is already rejected
 * before the `new Promise(...)` constructor returns, and PrimJS reports
 * unhandled rejections *at rejection time*: the engine has already escalated it
 * to a fatal main-thread exception (red box in dev, error-reporter spam in
 * release) by the time the caller's `invoke(...).catch(...)` on the very next
 * statement runs.
 *
 * No caller-side guard can win that race, and `@sigx/lynx-list`,
 * `@sigx/lynx-emoji`, `@sigx/lynx-webview` and `@sigx/lynx-gestures` all carry
 * correct-but-inert guards today. This is upstream's object, not ours — on
 * native, `mtRef.current` is an upstream `Element` (see `bindMtRef`), so fixing
 * our own `MTElementWrapper.invoke` does not cover the live path.
 *
 * Wrapping the original is useless: it *returns* the already-rejected promise,
 * so the damage is done before we get control. The method has to be replaced.
 * The replacement is behaviourally identical apart from deferring the
 * rejection by one microtask — settle an envelope that can only ever RESOLVE,
 * then derive the caller-facing promise with `.then()`.
 *
 * Applied once, lazily, off the first bound ref (the class is not otherwise
 * reachable — upstream exports it neither on `globalThis` nor via
 * `lynxWorkletImpl`). Guarded on the instance shape so an upstream rename
 * degrades to "unpatched", never to a broken `invoke`. Drop this module if
 * upstream defers the rejection itself.
 */

/** Patch applied (or definitively skipped) — never attempt twice. */
let settled = false;

interface UpstreamElement {
  element: MainThreadElement;
  invoke?: (methodName: string, params?: Record<string, unknown>) => Promise<unknown>;
  flushElementTree?: () => void;
}

/**
 * Replace `invoke` on the prototype of `instance` with a version whose
 * rejection is always deferred past the synchronous caller.
 *
 * @param instance - an upstream worklet `Element` (a bound `mtRef.current`).
 */
export function patchUpstreamInvoke(instance: unknown): void {
  if (settled) return;
  if (!instance || typeof instance !== 'object') return;

  const proto = Object.getPrototypeOf(instance) as UpstreamElement | null;
  // Shape guard: upstream's own Element, with the `element` handle we need to
  // re-issue the native call. Anything else is left alone.
  if (!proto || typeof proto.invoke !== 'function') return;
  if (!('element' in (instance as Record<string, unknown>))) return;

  settled = true;

  proto.invoke = function (
    this: UpstreamElement,
    methodName: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    type Settled = { ok: true; value: unknown } | { ok: false; err: Error };
    return new Promise<Settled>((resolve) => {
      if (typeof __InvokeUIMethod !== 'function') {
        resolve({ ok: false, err: new Error('UI method invoke: __InvokeUIMethod not available') });
        return;
      }
      __InvokeUIMethod(this.element, methodName, params ?? {}, (res) => {
        resolve(res.code === 0
          ? { ok: true, value: res.data }
          : { ok: false, err: new Error('UI method invoke: ' + JSON.stringify(res)) });
      });
      this.flushElementTree?.();
    }).then((r) => {
      if (!r.ok) throw r.err;
      return r.value;
    });
  };
}

/** Test seam — reset the once-only latch. */
export function __resetUpstreamInvokePatchForTest(): void {
  settled = false;
}
