/**
 * BG → MT hot-update bridge.
 *
 * The MT bundle has rspack's HMR runtime in code (because `module.hot.accept`
 * is referenced) but no transport feeding it updates. After a save, BG's HMR
 * client patches App.tsx and re-renders, generating worklet placeholders with
 * new content-hash `_wkltId`s. MT's `_workletMap` still holds the old IDs, so
 * the lookup fails (`bind of undefined`) when the user taps.
 *
 * This bridge closes the gap. We hook the same `webpackHotUpdate` event the
 * rspack HMR client subscribes to. On every cycle:
 *   1. Fetch the matching `main__main-thread.<hash>.hot-update.js` over the
 *      dev server URL (`__webpack_require__.p`).
 *   2. Extract every `registerWorkletInternal(...)` call from the response.
 *   3. Forward the concatenated calls to MT via
 *      `callLepusMethod('sigxApplyMtHotUpdate', { code }, ...)`.
 * The MT handler `eval`s them in the existing realm, registering the new IDs
 * into the live `_workletMap` before the user taps a freshly re-rendered
 * button.
 *
 * Loaded only in dev mode — wired into the BG entry by `lynx-plugin`'s
 * `applyEntry` when `enabledHMR` is true.
 */

import {
  extractRegistrations,
  extractSnapshotRegistrations,
} from './hmr-extract.js';

interface RspackEmitter {
  on(event: 'webpackHotUpdate', cb: (currentHash: string) => void): void;
}

// `@rspack/core/hot/emitter` is a CJS singleton EventEmitter the rspack HMR
// client subscribes to. We can't `import` it here — `@rspack/core` is a
// transitive build-time dep of the user app via rspeedy, not a runtime dep
// of this package, so rspack's resolver fails from our install location.
//
// Instead, locate it through the BG bundle's webpack module cache at runtime:
// after `@rspack/core/hot/dev-server` initialises (also injected into the BG
// entry by lynx-plugin), the emitter module is registered in
// `__webpack_require__.c` keyed by its resolved path. We scan the cache for
// the one whose `module.exports` looks like the EventEmitter singleton (has
// `on` + `emit` + an `events` bag).
declare const __webpack_require__: {
  p?: string;
  c?: Record<string, { exports: unknown }>;
  hu?: (chunkId: string) => string;
};

function findRspackEmitter(): RspackEmitter | undefined {
  const cache = __webpack_require__?.c;
  if (!cache) return undefined;
  for (const id in cache) {
    if (!id.includes('@rspack') || !id.endsWith('emitter.js')) continue;
    const exp = cache[id]?.exports as Record<string, unknown> | undefined;
    if (
      exp
      && typeof (exp as { on?: unknown }).on === 'function'
      && typeof (exp as { emit?: unknown }).emit === 'function'
    ) {
      return exp as unknown as RspackEmitter;
    }
  }
  return undefined;
}

// Defer subscription via a microtask: the entry chain prepends this bridge
// before `@rspack/core/hot/dev-server`, so at module-eval time the emitter
// isn't in the webpack cache yet. By the next microtask, dev-server has run
// its top-level code and the emitter module is cached.
Promise.resolve().then(() => {
  const emitter = findRspackEmitter();
  if (!emitter) {
    console.log('[sigx-mt-hmr-bridge] rspack emitter not found — bridge inactive');
    return;
  }
  emitter.on('webpackHotUpdate', () => {
    fetchAndForward();
  });
});

interface HotUpdate {
  modules: Record<string, (...args: unknown[]) => unknown>;
  runtime?: unknown;
}

function fetchAndForward(): void {
  // The `webpackHotUpdate` event payload is the *new* hash, but hot-update
  // chunks are named with the *previous* hash (the "delta-from" hash). Use
  // `__webpack_require__.hu` — same helper rspack's own loader uses — which
  // reads `__webpack_require__.h()` to build the URL with the right hash.
  const publicPath = __webpack_require__?.p ?? '';
  const hu = __webpack_require__?.hu;
  if (typeof hu !== 'function') return;
  const url = publicPath + hu('main__main-thread');

  // Lynx's BG runtime doesn't have a working `fetch` for arbitrary URLs in
  // many hosts; rspack's own HMR loader uses `lynx.requireModuleAsync` (see
  // `loadUpdateChunk` in the BG bundle). It returns the parsed hot-update
  // shape `{ modules, runtime }` — each `modules[id]` is the compiled JS
  // factory function. We extract registerWorkletInternal calls from
  // `factory.toString()` so we don't have to actually evaluate the factory
  // (which would import worklet-runtime / install-hybrid into BG's webpack
  // module graph, with unwanted side effects).
  const requireModuleAsync = (lynx as unknown as {
    requireModuleAsync?: (
      url: string,
      cb: (err: unknown, update: HotUpdate) => void,
    ) => void;
  })?.requireModuleAsync;
  if (typeof requireModuleAsync !== 'function') return;

  requireModuleAsync(url, (err, update) => {
    if (err) {
      console.log('[sigx-mt-hmr-bridge] requireModuleAsync failed:', String(err));
      return;
    }
    let combined = '';
    for (const id in update.modules) {
      const factory = update.modules[id];
      if (typeof factory === 'function') combined += factory.toString() + '\n';
    }
    const code = extractRegistrations(combined);
    const snapshotCode = extractSnapshotRegistrations(combined);
    if (!code && !snapshotCode) return;
    const app = lynx?.getNativeApp?.();
    if (!app || typeof app.callLepusMethod !== 'function') return;
    app.callLepusMethod('sigxApplyMtHotUpdate', { code, snapshotCode }, () => {});
  });
}

