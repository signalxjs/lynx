/**
 * Web-standard globals that Lynx's background JS thread (BTS) doesn't expose
 * as bare globals, even though the surrounding environment looks web-like
 * (setTimeout / fetch / Promise all work). Installed as a side effect at BG
 * startup so apps — and especially web-ported npm dependencies — can rely on
 * the standard global instead of the Lynx-namespaced method.
 *
 * `queueMicrotask`: on some Lynx engine versions (e.g. the 3.7 pods #296 was
 * reported on) microtask scheduling is only reachable as `lynx.queueMicrotask`
 * and the bare web global is undefined. Code that calls it (directly or
 * transitively) then throws or silently drops the scheduled work — e.g. a
 * reactive engine whose notification flush never runs, leaving state committed
 * but subscribers never notified (signalxjs/lynx#296). Newer engines do expose
 * the global, in which case the guard below leaves it untouched.
 *
 * We deliberately polyfill on top of `Promise` rather than delegating to
 * `lynx.queueMicrotask`: the native method reaches through to native runtime
 * state that isn't wired until after the app mounts, so calling it during
 * early module evaluation throws (`getNativeLynx of undefined`). A
 * `Promise.resolve().then(cb)` microtask works at any point in the lifecycle
 * and lands on the same JS microtask checkpoint — the standard `queueMicrotask`
 * polyfill. `Promise` is a reliable BG global (the op queue already schedules
 * its flush this way). A callback that throws is re-thrown from a `setTimeout`
 * so it surfaces as a genuine uncaught error (reaching the host error handler)
 * rather than being swallowed into an unhandled promise rejection — this is the
 * WHATWG-recommended `queueMicrotask` polyfill.
 *
 * Idempotent and non-clobbering: an existing global (a newer engine, a host
 * that already provides it, or a test stub) is left untouched.
 */
export function installGlobals(): void {
  const g = globalThis as Record<string, unknown>;

  if (typeof g['queueMicrotask'] !== 'function') {
    g['queueMicrotask'] = (cb: () => void) => {
      void Promise.resolve().then(cb).catch((err: unknown) => {
        setTimeout(() => {
          throw err;
        }, 0);
      });
    };
  }
}

// Side effect: run on import so the globals are in place before any other
// module's side effects. index.ts imports this first; ESM evaluates imported
// modules in order, so a bare `import './install-globals.js'` there guarantees
// installation ahead of jsx/types/model-processor/etc. (Calling installGlobals()
// between imports in index.ts would NOT work — import side effects hoist above
// it.)
installGlobals();
