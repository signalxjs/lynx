/**
 * runOnBackground — BG-side wiring for the MT→BG cross-thread call channel.
 *
 * Two responsibilities:
 *  1. `transformToWorklet(fn)` — wraps a BG function as a `JsFnHandle`
 *     `{ _jsFnId, _fn }` so the SWC transform can serialise it into the
 *     `_jsFn` slot of a worklet ctx. The BG worklet-loader emits inline
 *     `transformToWorklet(...)` calls when the user writes `runOnBackground(fn)`
 *     inside a `'main thread'` body.
 *  2. `Lynx.Sigx.RunOnBackground` listener — when the MT-side dispatcher
 *     fires, finds the matching JsFnHandle by `(execId, fnId)` from the
 *     registered worklet ctxs, runs `_fn(...params)`, dispatches
 *     `Lynx.Sigx.FunctionCallRet` back with `{resolveId, returnValue}`.
 *
 * Mirrors @lynx-js/react/runtime/lib/worklet/call/runOnBackground +
 * vue-lynx's run-on-background.ts (same protocol shape, sigx-namespaced
 * event types).
 */

const RUN_ON_BACKGROUND = 'Lynx.Sigx.RunOnBackground';
const FUNCTION_CALL_RET = 'Lynx.Sigx.FunctionCallRet';

// ---------------------------------------------------------------------------
// JsFnHandle shape — serialisable representation of a BG function
// ---------------------------------------------------------------------------

export interface JsFnHandle {
  _jsFnId?: number;
  _execId?: number;
  _fn?: (...args: unknown[]) => unknown;
  _isFirstScreen?: boolean;
  _error?: string;
}

interface WorkletCtx {
  _wkltId: string;
  _execId?: number;
  _c?: Record<string, unknown>;
  _jsFn?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// transformToWorklet — mint a JsFnHandle for cross-thread dispatch
//
// The SWC JS pass emits inline `transformToWorklet(fn)` calls in the BG bundle
// when it sees `runOnBackground(fn)` inside a `'main thread'` body. The handle
// flows into the worklet ctx's `_jsFn` slot; MT extracts it and dispatches via
// `runOnBackground(handle)(...args)`.
// ---------------------------------------------------------------------------

let lastJsFnId = 0;

export function transformToWorklet(
  fn: (...args: unknown[]) => unknown,
): JsFnHandle {
  const id = ++lastJsFnId;
  if (typeof fn !== 'function') {
    return {
      _jsFnId: id,
      _error:
        `Argument of runOnBackground should be a function, got [${typeof fn}]`,
    };
  }
  // Stamp toJSON so JSON.stringify of the worklet ctx replaces the function
  // body with a placeholder string — MT only needs `_jsFnId`/`_execId`.
  (fn as unknown as { toJSON?: () => string }).toJSON ??= () =>
    '[BackgroundFunction]';
  return { _jsFnId: id, _fn: fn };
}

// ---------------------------------------------------------------------------
// IndexMap — auto-incrementing Map (worklet exec-id allocator)
// ---------------------------------------------------------------------------

class IndexMap<T> {
  private lastIndex = 0;
  private map = new Map<number, T>();

  add(value: T): number {
    const id = ++this.lastIndex;
    this.map.set(id, value);
    return id;
  }

  get(index: number): T | undefined {
    return this.map.get(index);
  }

  remove(index: number): void {
    this.map.delete(index);
  }
}

class WorkletExecIdMap extends IndexMap<WorkletCtx> {
  override add(worklet: WorkletCtx): number {
    const execId = super.add(worklet);
    worklet._execId = execId;
    return execId;
  }

  findJsFnHandle(execId: number, fnId: number): JsFnHandle | undefined {
    const worklet = this.get(execId);
    if (!worklet) return undefined;

    const visited = new Set<object>();
    const search = (value: unknown): JsFnHandle | undefined => {
      if (value === null || typeof value !== 'object') return undefined;
      const obj = value as Record<string, unknown>;
      if (visited.has(obj)) return undefined;
      visited.add(obj);
      if ('_jsFnId' in obj && obj['_jsFnId'] === fnId) {
        return obj as JsFnHandle;
      }
      for (const key in obj) {
        const result = search(obj[key]);
        if (result) return result;
      }
      return undefined;
    };

    return search(worklet);
  }
}

// ---------------------------------------------------------------------------
// Module state — lazy-init so SSR / tests don't pay for the listener wiring
// ---------------------------------------------------------------------------

let execIdMap: WorkletExecIdMap | undefined;

interface CoreContextLike {
  addEventListener?: (type: string, listener: (e: { data?: unknown }) => void) => void;
  dispatchEvent?: (e: { type: string; data: string }) => void;
}

function getCoreContext(): CoreContextLike | undefined {
  if (typeof lynx === 'undefined') return undefined;
  const obj = lynx as unknown as { getCoreContext?: () => CoreContextLike };
  return typeof obj.getCoreContext === 'function' ? obj.getCoreContext() : undefined;
}

function init(): void {
  execIdMap = new WorkletExecIdMap();
  const ctx = getCoreContext();
  ctx?.addEventListener?.(RUN_ON_BACKGROUND, runJSFunction);
}

// ---------------------------------------------------------------------------
// registerWorkletCtx — stamp _execId on outgoing worklet ctxs
//
// Called from nodeOps.patchProp (SET_WORKLET_EVENT path) and from
// runOnMainThread before shipping a ctx across threads. Must run BEFORE
// JSON.stringify so the ctx carries `_execId` to MT.
// ---------------------------------------------------------------------------

export function registerWorkletCtx(ctx: WorkletCtx): void {
  if (!execIdMap) init();
  execIdMap!.add(ctx);
}

// ---------------------------------------------------------------------------
// runJSFunction — handles MT → BG dispatch
// ---------------------------------------------------------------------------

interface RunOnBackgroundData {
  obj: { _jsFnId: number; _execId: number };
  params: unknown[];
  resolveId: number;
}

function runJSFunction(event: { data?: unknown }): void {
  let data: RunOnBackgroundData;
  try {
    data = JSON.parse(event.data as string) as RunOnBackgroundData;
  } catch {
    return; // malformed bridge message — drop
  }
  const handle = execIdMap?.findJsFnHandle(data.obj._execId, data.obj._jsFnId);
  if (!handle?._fn) {
    // Fn is gone — likely the owning worklet ctx was unregistered. Resolve
    // with undefined so the MT promise doesn't hang.
    dispatchReturn(data.resolveId, undefined);
    return;
  }
  let returnValue: unknown;
  try {
    returnValue = handle._fn(...data.params);
  } catch (e) {
    dispatchReturn(data.resolveId, undefined);
    throw e;
  }
  // Promise return values are not transferable across the JSON bridge — caller
  // must await on the BG fn body itself if they need async results.
  dispatchReturn(data.resolveId, returnValue);
}

function dispatchReturn(resolveId: number, returnValue: unknown): void {
  const ctx = getCoreContext();
  ctx?.dispatchEvent?.({
    type: FUNCTION_CALL_RET,
    data: JSON.stringify({ resolveId, returnValue }),
  });
}

// ---------------------------------------------------------------------------
// User-facing stub — replaced by SWC at every `runOnBackground(fn)` call site
// inside a `'main thread'` body. If you reach this code path at runtime, the
// build transform did not run on this file.
// ---------------------------------------------------------------------------

export function runOnBackground<R, Fn extends (...args: never[]) => R>(
  _fn: Fn,
): (...args: Parameters<Fn>) => Promise<R> {
  throw new Error(
    'runOnBackground() can only be used inside \'main thread\' functions. '
      + 'The SWC worklet transform should replace this call at build time — '
      + 'verify @sigx/lynx-plugin\'s worklet-loader is wired into your bundler.',
  );
}

// ---------------------------------------------------------------------------
// Reset — for testing only
// ---------------------------------------------------------------------------

export function resetRunOnBackgroundState(): void {
  execIdMap = undefined;
  lastJsFnId = 0;
}
