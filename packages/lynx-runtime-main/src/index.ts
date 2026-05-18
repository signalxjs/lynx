/// <reference path="./shims.d.ts" />

// Side-effect import — entry-main.ts registers globalThis.renderPage /
// processData / sigxPatchUpdate / sigxRunOnMT and side-effect imports
// @lynx-js/react/worklet-runtime which installs lynxWorkletImpl /
// registerWorkletInternal / runWorklet. Must run at module load time so
// the main-thread entry of the Lynx template has these globals.
import './entry-main';

export { elements, pageUniqueId, setPageUniqueId } from './element-registry';
export { applyOps, resetMainThreadState } from './ops-apply';
export { MTElementWrapper } from './mt-element';
export { invokeWorklet, type WorkletPlaceholder } from './worklet-events';
export {
  setSlotWorklet,
  setSlotBgSign,
  flushDirtySlots,
  resetSlotStates,
} from './event-slots';
export {
  HYBRID_WORKLET_ID,
  hybridCtx,
  installHybridWorklet,
} from './hybrid-worklet';

/**
 * Compatibility shim — upstream's worklet-runtime provides the canonical
 * `loadWorkletRuntime`, but @lynx-js/react/transform's LEPUS output imports
 * it from `runtimePkg`. Our MT loader strips the import + gating before
 * shipping registrations, so this re-export is only for the rare case where
 * upstream's raw output is used unstripped (tests, future Phase 1c).
 */
export function loadWorkletRuntime(_globDynamicComponentEntry?: unknown): boolean {
  return true;
}
