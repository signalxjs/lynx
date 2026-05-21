/**
 * Lynx renderer entry -- creates the renderer, defines lynxMount, and
 * registers it as the default mount via setDefaultMount.
 *
 * Ported pattern from packages/runtime-terminal/src/index.ts
 */
import { createRenderer, setDefaultMount } from '@sigx/runtime-core/internals';
import type { MountFn, AppContext } from '@sigx/runtime-core';
import { nodeOps } from './nodeOps.js';
import { flushNow } from './flush.js';
import { installEventPublisher } from './op-queue.js';
import { createPageRoot, type ShadowElement } from './shadow-element.js';

// Install host-required event stubs (publishEvent / publicComponentEvent)
// before sigx mounts anything so the first MT → BG dispatch doesn't crash.
installEventPublisher();

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const renderer = createRenderer<ShadowElement, ShadowElement>(nodeOps);
export const { render } = renderer;

// ---------------------------------------------------------------------------
// lynxMount -- MountFn for Lynx environments
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HMR mount state — tracked so hot reloads can tear down and re-mount
// ---------------------------------------------------------------------------

let _hmrMounted = false;
let _hmrRoot: ShadowElement | null = null;
let _hmrAppContext: AppContext | undefined = undefined;

/**
 * Mount function for Lynx environments.
 *
 * The page root is a ShadowElement with id=1 — the Main Thread creates the
 * real page element in renderPage() before the BG thread runs. All subsequent
 * ops reference this root by id so the MT can resolve it.
 *
 * On subsequent calls (hot reload), the previous tree is torn down and the
 * Main Thread is signalled to reset before the new tree is mounted.
 *
 * @example
 * ```tsx
 * import '@sigx/lynx-runtime'; // side-effect: registers lynxMount
 * import { defineApp } from '@sigx/sigx';
 *
 * defineApp(<App />).mount();
 * ```
 */
export const lynxMount: MountFn = (element, _container, appContext) => {
  // Re-install in case the per-card app instance only became available
  // after this module's top-level executed (timing varies by Lynx host).
  installEventPublisher();

  // Hot-reload fallback: if lynxMount is called again (e.g., main.tsx
  // re-executed because a non-component module change bubbled up), the
  // Lynx native engine cannot handle structural tree mutations. Fall
  // back to a full card reload. With component-level HMR active, this
  // path is only reached for non-component changes.
  // See docs/hmr-investigation.md for details.
  if (_hmrMounted && _hmrRoot) {
    console.log('[sigx-hmr] Non-component change — triggering full card reload');
    triggerLiveReload();
    return () => {};
  }

  _hmrMounted = true;
  const root = createPageRoot();
  _hmrRoot = root;
  _hmrAppContext = appContext;
  render(element, root, appContext);
  flushNow();
  return () => {
    render(null, root, appContext);
    flushNow();
    _hmrMounted = false;
    _hmrRoot = null;
  };
};

// ---------------------------------------------------------------------------
// Register as the default mount -- activated only when this module is imported
// ---------------------------------------------------------------------------

setDefaultMount(lynxMount);

// ---------------------------------------------------------------------------
// Live-reload fallback
//
// When a webpack HMR update cannot be applied (module shape changed too
// drastically), fall back to reloading the entire card bundle — the Lynx
// equivalent of a browser full-page refresh.
// ---------------------------------------------------------------------------

/**
 * Trigger a full card reload via the Lynx host. Tries several host APIs
 * in order of preference:
 * 1. `lynxCoreInject.tt.reloadCard()` — standard Lynx host reload
 * 2. `lynx.getNativeApp().callLepusMethod('sigxReloadCard', ...)` — custom
 *    reload signal the host can implement
 * If none are available, logs a warning — the developer must manually reload.
 */
function triggerLiveReload(): void {
  try {
    // Option 1: lynxCoreInject.tt.reloadCard (available in some Lynx hosts)
    if (typeof lynxCoreInject !== 'undefined' && lynxCoreInject?.tt) {
      const reloadCard = lynxCoreInject.tt['reloadCard'];
      if (typeof reloadCard === 'function') {
        (reloadCard as () => void)();
        return;
      }
    }

    // Option 2: signal via callLepusMethod so the MT can trigger a reload
    if (typeof lynx !== 'undefined') {
      const app = lynx?.getNativeApp?.();
      if (app && typeof app.callLepusMethod === 'function') {
        app.callLepusMethod('sigxReloadCard', {}, () => {});
        return;
      }
    }

    console.log(
      '[sigx-hmr] No reload API available. Please manually reload the card.',
    );
  } catch (e) {
    console.log('[sigx-hmr] triggerLiveReload error:', String(e));
  }
}

// ---------------------------------------------------------------------------
// Webpack HMR acceptance
//
// Accept hot updates to this module. With component-level HMR, most changes
// are handled by the HMR loader (self-accepting component modules). This
// catch-all only fires for changes to render.ts itself or its direct deps.
// ---------------------------------------------------------------------------

// `lynx` and `lynxCoreInject` are declared in src/shims.d.ts.

declare var module: { hot?: {
  accept(cb?: (err?: Error) => void): void;
} } | undefined;

if (typeof module !== 'undefined' && module?.hot) {
  module.hot.accept((err?: Error) => {
    if (err) {
      console.log(
        '[sigx-hmr] Hot update failed, falling back to live reload:',
        String(err),
      );
      triggerLiveReload();
    }
  });
}
