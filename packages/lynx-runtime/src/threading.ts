/**
 * Cross-thread function invocation primitives for Lynx MTS.
 *
 * - runOnMainThread(fn): BG → MT — invoke a function on the Main Thread
 * - runOnBackground(fn): MT → BG — invoke a function on the Background Thread
 *
 * ## Worklet placeholder semantics (Phase 1b)
 *
 * The `'main thread'` directive inside the function passed to runOnMainThread
 * tells the build pipeline (`@lynx-js/react/transform`) to:
 *   1. Replace the function with a `{ _wkltId }` placeholder in the BG bundle.
 *   2. Emit a `registerWorkletInternal("main-thread", "<wkltId>", function(...) { ... })`
 *      call into the MT bundle that registers the function in the MT-side worklet
 *      registry.
 *
 * At runtime, runOnMainThread receives the placeholder, returns a callable, and
 * each invocation ships `{ wkltId, args }` over `callLepusMethod('sigxRunOnMT')`
 * to the MT bridge installed in `entry-main.ts`.
 *
 * ## Usage
 *
 * ```tsx
 * import { runOnMainThread, runOnBackground } from '@sigx/lynx-runtime';
 *
 * const updateOffset = runOnMainThread((offset: number) => {
 *   'main thread';
 *   ref.current?.setStyleProperties({ transform: `translateX(${offset}px)` });
 * });
 * updateOffset(100);
 * ```
 *
 * The `(offset) => { 'main thread'; ... }` source is what the user writes; after
 * the build transform it becomes `{ _wkltId: '...' }` at this call site.
 */

// `lynx` and `lynxCoreInject` are closure-injected — see shims.d.ts

import { MainThreadRef } from './main-thread-ref.js';

// ---------------------------------------------------------------------------
// Worklet placeholder shape (post-transform)
// ---------------------------------------------------------------------------

interface WorkletPlaceholder {
  _wkltId: string;
  _c?: Record<string, unknown>;
}

function isWorkletPlaceholder(v: unknown): v is WorkletPlaceholder {
  return typeof v === 'object' && v !== null && '_wkltId' in (v as object);
}

/**
 * Convert MainThreadRef instances inside `_c` to plain `{ _wvid, _initValue }`
 * placeholders so they survive JSON serialization to MT. Upstream's worklet
 * runtime (`I()` walker in `runtime/worklet-runtime/main.js`) recognizes the
 * shape and resolves it via `lynxWorkletImpl._refImpl._workletRefMap`.
 *
 * Same logic as `nodeOps.ts:sanitizeCaptured`. Kept local to avoid pulling
 * the renderer into this module.
 */
function sanitizeCaptured(captured: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in captured) {
    const v = captured[k];
    if (v instanceof MainThreadRef) {
      out[k] = { _wvid: v._wvid, _initValue: v._initValue };
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// runOnMainThread — BG → MT
// ---------------------------------------------------------------------------

export function runOnMainThread<TArgs extends unknown[]>(
  worklet: WorkletPlaceholder | ((...args: TArgs) => unknown),
): (...args: TArgs) => Promise<unknown> {
  // The build-time transform replaces the user's function with a placeholder.
  // If we receive an actual function here it means the transform didn't run
  // (test / dev fallback) — we can't ship a function across threads, so we
  // run it locally on BG.
  if (typeof worklet === 'function') {
    return (...args: TArgs): Promise<unknown> => {
      try {
        return Promise.resolve(worklet(...args));
      } catch (e) {
        return Promise.reject(e);
      }
    };
  }

  if (!isWorkletPlaceholder(worklet)) {
    throw new Error('runOnMainThread: argument is not a worklet placeholder. Did the build transform run?');
  }

  const wkltId = worklet._wkltId;
  // Snapshot _c at placeholder-construction time. Captures are resolved to
  // their identifier values at SWC transform time, so this is the right
  // moment — the user calls runOnMainThread once at setup with the
  // already-captured placeholder.
  const captured = worklet._c ? sanitizeCaptured(worklet._c) : undefined;

  return (...args: TArgs): Promise<unknown> => {
    return new Promise<unknown>((resolve) => {
      if (typeof lynx !== 'undefined') {
        const app = lynx?.getNativeApp?.();
        if (app && typeof app.callLepusMethod === 'function') {
          app.callLepusMethod(
            'sigxRunOnMT',
            { wkltId, args, captured },
            (result: unknown) => resolve(result),
          );
          return;
        }
      }

      // Same-thread fallback (testing only)
      const g = globalThis as Record<string, unknown>;
      if (typeof g['sigxRunOnMT'] === 'function') {
        let result: unknown;
        (g['sigxRunOnMT'] as Function)(
          { wkltId, args, captured },
          (r: unknown) => { result = r; },
        );
        resolve(result);
        return;
      }

      resolve(undefined);
    });
  };
}

// ---------------------------------------------------------------------------
// runOnBackground — MT → BG
//
// Delegated to ./run-on-background.ts. The exported `runOnBackground` from
// that module is a throwing stub: the SWC build transform replaces every
// `runOnBackground(fn)` call inside a `'main thread'` body with a bridged
// dispatch (BG: `transformToWorklet(fn)` → JsFnHandle in the worklet ctx;
// MT: bare `runOnBackground(handle)` resolved against globalThis). If the
// stub is hit at runtime, the build transform did not run.
// ---------------------------------------------------------------------------

export {
  runOnBackground,
  transformToWorklet,
  resetRunOnBackgroundState,
} from './run-on-background.js';

export function resetThreading(): void {
  // Kept for API compatibility with tests that previously reset the local
  // stub. The runOnBackground module now exposes its own reset.
}
