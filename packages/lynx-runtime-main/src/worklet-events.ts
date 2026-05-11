/**
 * Helpers for invoking worklets from the BG → MT bridge.
 *
 * Most of the worklet machinery (registry, ref map, event dispatch) is owned
 * by `@lynx-js/react/worklet-runtime`, which is side-effect-imported from
 * `entry-main.ts`. That runtime installs `globalThis.lynxWorkletImpl`,
 * `globalThis.registerWorkletInternal`, and `globalThis.runWorklet`. Lynx
 * native dispatches MT-routed events directly into `runWorklet`.
 *
 * What sigx-lynx still needs to provide is the `runOnMainThread` BG → MT call
 * path: BG ships `{ wkltId, args }` over `callLepusMethod('sigxRunOnMT')`, the
 * MT bridge handler in `entry-main.ts` calls `invokeWorklet()` here, and we
 * look up the function in upstream's `_workletMap`.
 */

interface WorkletImpl {
  _workletMap: Record<string, Function>;
  _refImpl?: {
    _workletRefMap: Record<number, { current: unknown; _wvid: number }>;
  };
}

export interface WorkletPlaceholder {
  _wkltId: string;
  _c?: Record<string, unknown>;
}

function getWorkletImpl(): WorkletImpl | undefined {
  return (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
    | WorkletImpl
    | undefined;
}

/**
 * Invoke a worklet by id with the given args. Used by the runOnMainThread
 * bridge — event-driven worklets go through Lynx's native runWorklet path
 * and never touch this function.
 */
export function invokeWorklet(
  wkltId: string,
  captured: Record<string, unknown> | undefined,
  args: unknown[],
): unknown {
  const impl = getWorkletImpl();
  if (!impl) {
    console.log('[sigx-mt] lynxWorkletImpl not initialized');
    return undefined;
  }
  const fn = impl._workletMap[wkltId];
  if (!fn) {
    console.log('[sigx-mt] worklet not registered:', wkltId);
    return undefined;
  }
  // Match upstream's calling convention: `function(arg) { let { x } = this["_c"]; ... }`
  try {
    return fn.apply({ _c: captured ?? {} }, args);
  } catch (e) {
    console.log('[sigx-mt] worklet threw:', String(e));
    return undefined;
  }
}

/** Reset hook — for testing. The upstream worklet-runtime has its own state. */
export function resetWorkletEvents(): void {
  // No sigx-side state to clear; upstream's _workletMap survives module reset
  // (registrations re-run when the user module re-evaluates on hot reload).
}
