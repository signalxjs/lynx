/**
 * MT-side runOnBackground — dispatches function calls from the Main Thread
 * to the Background Thread via 'Lynx.Sigx.RunOnBackground' events.
 *
 * Called inside extracted worklet bodies on the Main Thread. The SWC LEPUS
 * pass leaves bare `runOnBackground(_jsFnK)` references in the registered
 * worklet body; we install this implementation as `globalThis.runOnBackground`
 * from `entry-main.ts` so the bare identifier resolves at runtime.
 *
 * Mirrors @lynx-js/react/runtime/lib/worklet/call/runOnMainThread (the dual
 * direction) and vue-lynx's run-on-background-mt.ts. Sigx-namespaced event
 * types so we don't conflict with upstream's own bridge if it ships in the
 * same lynx process.
 */

const RUN_ON_BACKGROUND = 'Lynx.Sigx.RunOnBackground';
const FUNCTION_CALL_RET = 'Lynx.Sigx.FunctionCallRet';

// ---------------------------------------------------------------------------
// JsFnHandle shape — matches BG-side @sigx/lynx-runtime/run-on-background.ts
// ---------------------------------------------------------------------------

interface JsFnHandle {
  _jsFnId?: number;
  _execId?: number;
  _isFirstScreen?: boolean;
  _error?: string;
}

// ---------------------------------------------------------------------------
// Return-value resolver — correlates resolveId → Promise resolve callback
// ---------------------------------------------------------------------------

let resolveMap: Map<number, (v: unknown) => void> | undefined;
let nextResolveId = 1;

interface JSContextLike {
  addEventListener?: (type: string, listener: (e: { data?: unknown }) => void) => void;
  dispatchEvent?: (e: { type: string; data: string }) => void;
}
interface LynxLike {
  getJSContext?: () => JSContextLike;
}

function getJSContext(): JSContextLike | undefined {
  // On MT, `lynx` is a globalThis property (no closure injection like BG).
  const lynxObj = (globalThis as { lynx?: LynxLike }).lynx;
  return lynxObj?.getJSContext?.();
}

function initReturnListener(): void {
  resolveMap = new Map();
  getJSContext()?.addEventListener?.(FUNCTION_CALL_RET, (event) => {
    let payload: { resolveId: number; returnValue: unknown };
    try {
      payload = JSON.parse(event.data as string);
    } catch {
      return;
    }
    const resolve = resolveMap?.get(payload.resolveId);
    if (resolve) {
      resolveMap!.delete(payload.resolveId);
      resolve(payload.returnValue);
    }
  });
}

// ---------------------------------------------------------------------------
// dispatch — ship the call across to BG
// ---------------------------------------------------------------------------

function dispatch(fnId: number, params: unknown[], execId: number, resolveId: number): void {
  getJSContext()?.dispatchEvent?.({
    type: RUN_ON_BACKGROUND,
    data: JSON.stringify({
      obj: { _jsFnId: fnId, _execId: execId },
      params,
      resolveId,
    }),
  });
}

// ---------------------------------------------------------------------------
// First-screen delay hook — lynxWorkletImpl provides this when the MT runtime
// hasn't finished bootstrapping yet (worklet was loaded directly into the
// LEPUS template, no _execId stamped). Delegate to upstream's implementation
// when available; otherwise, the call is a no-op.
// ---------------------------------------------------------------------------

interface LynxWorkletImpl {
  _runOnBackgroundDelayImpl?: {
    delayRunOnBackground(
      handle: JsFnHandle,
      cb: (fnId: number, execId: number) => void,
    ): void;
  };
}

declare const lynxWorkletImpl: LynxWorkletImpl | undefined;

// ---------------------------------------------------------------------------
// runOnBackground — the global function called in extracted LEPUS code
// ---------------------------------------------------------------------------

export function runOnBackground(
  handle: JsFnHandle,
): (...args: unknown[]) => Promise<unknown> {
  return (...params: unknown[]): Promise<unknown> => {
    return new Promise((resolve) => {
      if (!resolveMap) initReturnListener();
      const resolveId = nextResolveId++;
      resolveMap!.set(resolveId, resolve);

      if (
        handle._isFirstScreen
        && typeof lynxWorkletImpl !== 'undefined'
        && lynxWorkletImpl?._runOnBackgroundDelayImpl
      ) {
        lynxWorkletImpl._runOnBackgroundDelayImpl.delayRunOnBackground(
          handle,
          (fnId, execId) => dispatch(fnId, params, execId, resolveId),
        );
        return;
      }

      if (handle._jsFnId == null || handle._execId == null) {
        // Handle never carried a (fnId, execId) pair — most likely the BG
        // sender did not call registerWorkletCtx. Resolve undefined so the
        // worklet promise settles instead of leaking.
        resolveMap!.delete(resolveId);
        resolve(undefined);
        return;
      }

      dispatch(handle._jsFnId, params, handle._execId, resolveId);
    });
  };
}

// ---------------------------------------------------------------------------
// Reset — for testing only
// ---------------------------------------------------------------------------

export function resetRunOnBackgroundMtState(): void {
  resolveMap = undefined;
  nextResolveId = 1;
}
