/**
 * Main Thread (Lepus) bootstrap entry.
 *
 * Injected by @sigx/lynx-plugin as the sole content of the main-thread bundle.
 * Sets up:
 *   - globalThis.processData   — required by Lynx Lepus runtime (data processor)
 *   - globalThis.renderPage    — creates the Lynx page root (id=1)
 *   - globalThis.updatePage    — no-op stub (required by Lynx Lepus runtime)
 *   - globalThis.sigxPatchUpdate — receives ops from Background Thread
 */

import { elements, setPageUniqueId } from './element-registry';
import { applyOps, resetMainThreadState, setPlaceholder } from './ops-apply';
import { invokeWorklet } from './worklet-events';
import { runOnBackground } from './run-on-background-mt';
import { installAvBridgeFlushHook } from './animated-bridge-mt';

const g = globalThis as Record<string, unknown>;

// CRITICAL: SystemInfo must be set BEFORE the @lynx-js/react/worklet-runtime
// IIFE evaluates (it reads SystemInfo as a free identifier at init time).
// lynx-plugin orders MT entries [entry-main, worklet-runtime, ...userImports]
// so this module body runs before the worklet-runtime entry. Keeping the
// install in module body (not an import) prevents vite from hoisting it.
if (g['SystemInfo'] === undefined) {
  const lynxObj = (g as { lynx?: { SystemInfo?: unknown } })['lynx'];
  g['SystemInfo'] = lynxObj?.SystemInfo ?? {};
}

/** PAGE_ROOT_ID must match the value used in the BG-thread renderer */
const PAGE_ROOT_ID = 1;

// Lynx Lepus runtime requires globalThis.processData to be set.
// It is called to transform initial data before renderPage runs.
// For sigx we have no data processors, so just pass data through.
g['processData'] = function (data: unknown, _processorName?: string): unknown {
  return data ?? {};
};

// Lynx calls renderPage on the Main Thread first (before Background JS runs).
// We create the root page element and store it as id=1 so Background ops that
// target the root can resolve it correctly.
g['renderPage'] = function (_data: unknown): void {
  resetMainThreadState();
  const page = __CreatePage('0', 0);
  __SetCSSId([page], 0);
  setPageUniqueId(__GetElementUniqueID(page));
  elements.set(PAGE_ROOT_ID, page);

  // Append a placeholder __CreateView under the page root so the host sees a
  // non-empty tree immediately. Without this, the host's "no UI within timeout"
  // check fires before the BG thread's first ops batch arrives, producing a
  // phantom USER_RUNTIME_ERROR. The placeholder is removed on the first
  // applyOps() call (see ops-apply.ts).
  const placeholder = __CreateView(__GetElementUniqueID(page));
  __SetCSSId([placeholder], 0);
  __AppendElement(page, placeholder);
  setPlaceholder(page, placeholder);

  __FlushElementTree(page);
};

// Lynx may call updatePage / updateGlobalProps after data changes.
// We have no data binding on Main Thread, so these are no-ops.
g['updatePage'] = function (_data: unknown): void {
  // no-op
};

g['updateGlobalProps'] = function (_data: unknown): void {
  // no-op
};

// Called by the BG Thread via callLepusMethod('sigxHotReload', {}) when a
// webpack HMR update is about to be applied. Resets the Main Thread element
// registry and re-creates the page root so the next sigxPatchUpdate batch
// builds on a clean tree.
//
// NOTE: With component-level HMR, component file changes are self-accepted
// by the HMR loader and patched in-place on the BG thread — this handler
// is NOT involved. It exists as a safety net for future non-component
// reload scenarios (e.g., if a host decides to send sigxHotReload
// explicitly). See docs/hmr-investigation.md.
g['sigxHotReload'] = function (): void {
  const existingPage = elements.get(PAGE_ROOT_ID);
  resetMainThreadState();

  const page = existingPage ?? __CreatePage('0', 0);
  __SetCSSId([page], 0);
  setPageUniqueId(__GetElementUniqueID(page));
  elements.set(PAGE_ROOT_ID, page);

  const placeholder = __CreateView(__GetElementUniqueID(page));
  __SetCSSId([placeholder], 0);
  __AppendElement(page, placeholder);
  setPlaceholder(page, placeholder);

  __FlushElementTree(page);
};

// Called by the BG Thread via callLepusMethod('sigxApplyMtHotUpdate', { code }).
// `code` is the concatenated `registerWorkletInternal(...)` calls extracted
// from the matching `main__main-thread.<hash>.hot-update.js` file. Eval'd in
// the existing realm so new content-hash worklet IDs land in the live
// `_workletMap` before the user taps a re-rendered button.
//
// See `lynx-runtime/src/mt-hmr-bridge.ts` for the BG-side fetch + forward.
g['sigxApplyMtHotUpdate'] = function ({ code }: { code: string }): void {
  if (!code) return;
  try {
    new Function(code)();
  } catch (e) {
    console.log('[sigx-mt] sigxApplyMtHotUpdate eval failed:', String(e));
  }
};

// Called by the BG Thread via callLepusMethod('sigxPatchUpdate', { data }).
g['sigxPatchUpdate'] = function ({ data }: { data: string }): void {
  let ops: unknown[];
  try {
    ops = JSON.parse(data) as unknown[];
  } catch (e) {
    console.log('[sigx-mt] sigxPatchUpdate JSON parse failed:', String(e));
    return;
  }
  try {
    applyOps(ops);
  } catch (e) {
    console.log('[sigx-mt] applyOps threw:', String(e));
  }
  // applyOps() already calls __FlushElementTree() at its tail.
};

// ---------------------------------------------------------------------------
// runOnMainThread bridge (BG → MT worklet invocation)
//
// Called by the BG Thread via callLepusMethod('sigxRunOnMT',
// { wkltId, args, captured }). When `captured` is supplied, route through
// upstream's `runWorklet({_wkltId, _c}, args)` so its `I()` walker hydrates
// the placeholders inside `_c` (resolves nested `{_wkltId}` worklet refs to
// callable functions and `{_wvid}` ref placeholders to live MainThreadRefs
// from `_workletRefMap`). This matches the path SET_WORKLET_EVENT uses for
// JSX-attached MT handlers, and is what makes captures like
// `runOnMainThread(() => { 'main thread'; withSpring(sv, 0); })` work
// (`withSpring` is a worklet placeholder that needs hydration before the
// destructure-and-call inside the body).
//
// `invokeWorklet` is kept as a fallback for the `captured === undefined`
// case (no captures to hydrate) and for direct-from-MT callers that already
// hand over a hydrated ctx.
// ---------------------------------------------------------------------------

g['sigxRunOnMT'] = function (
  { wkltId, args, captured }: { wkltId: string; args: unknown[]; captured?: Record<string, unknown> },
  callback?: (result: unknown) => void,
): void {
  const argsArr = args ?? [];
  let result: unknown;
  const runWorkletFn = (globalThis as Record<string, unknown>)['runWorklet'] as
    | ((placeholder: { _wkltId: string; _c?: Record<string, unknown> }, args: unknown[]) => unknown)
    | undefined;
  if (captured && typeof runWorkletFn === 'function') {
    try {
      result = runWorkletFn({ _wkltId: wkltId, _c: captured }, argsArr);
    } catch (e) {
      console.log('[sigx-mt] sigxRunOnMT worklet threw:', String(e));
      result = undefined;
    }
  } else {
    result = invokeWorklet(wkltId, captured, argsArr);
  }
  if (typeof callback === 'function') {
    callback(result);
  }
};

// MT-side worklet event dispatch is handled natively: the SET_WORKLET_EVENT
// op handler in ops-apply.ts calls __AddEvent with `{ type: 'worklet', value }`,
// and Lynx native routes those to globalThis.runWorklet (installed by the
// @lynx-js/react/worklet-runtime side-effect import above).

// Install the SharedValue bridge flush hook. Wraps __FlushElementTree so
// every native flush also runs flushAvBridgePublishes (covers the
// touchmove path: worklet writes SharedValue → calls setStyleProperties →
// upstream queues a __FlushElementTree microtask → our wrapper publishes
// diffed SharedValues to BG before the tree flush). Idempotent.
installAvBridgeFlushHook();

// ---------------------------------------------------------------------------
// runOnBackground bridge (MT → BG worklet invocation)
//
// SWC's LEPUS pass leaves bare `runOnBackground(_jsFnK)` references in the
// extracted worklet body — they resolve as a free identifier. Install our
// MT-side dispatcher as a global so those calls reach the BG event bus.
// ---------------------------------------------------------------------------
g['runOnBackground'] = runOnBackground;
