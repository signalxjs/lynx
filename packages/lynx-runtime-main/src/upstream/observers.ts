// Copyright 2025 The Lynx Authors. All rights reserved.
// TypeScript types added 2026 by SignalX contributors.
//
// Licensed under the Apache License, Version 2.0. The full license text and
// upstream attribution are reproduced in `THIRD_PARTY_NOTICES.md` at the
// root of this package (`@sigx/lynx-runtime-main`). The MIT LICENSE at the
// repository root governs the rest of this repository; it does NOT apply
// to this file.
//
// Vendored from `@lynx-js/react@0.120.0`'s
// `runtime/lib/worklet-runtime/bindings/observers.js`. Source preserved
// verbatim; only types added. We vendor this 15-LOC helper to drop the
// `@lynx-js/react` runtime dependency from `@sigx/lynx-runtime-main`, which
// in turn keeps `@types/react` out of the install tree of consumer apps
// (sigx-lynx apps use sigx primitives, not ReactLynx JSX).

interface WorkletLike {
  _execId?: number;
}

interface JsFunctionLifecycleManager {
  addRef(execId: number, worklet: WorkletLike): void;
}

interface EventDelayImpl {
  runDelayedWorklet(worklet: WorkletLike, element: unknown): void;
}

interface LynxWorkletImpl {
  _jsFunctionLifecycleManager?: JsFunctionLifecycleManager;
  _eventDelayImpl: EventDelayImpl;
  _hydrateCtx(worklet: WorkletLike, oldWorklet: WorkletLike): void;
}

function impl(): LynxWorkletImpl | undefined {
  return (globalThis as { lynxWorkletImpl?: LynxWorkletImpl }).lynxWorkletImpl;
}

/**
 * Must be called when a worklet context is updated. Mirrors the upstream
 * ReactLynx behaviour:
 *   1. Register the new worklet with the JS-side lifecycle manager (so the
 *      background thread can free it).
 *   2. On first screen with a previous ctx, hydrate the new ctx from the old.
 *   3. On first screen, flush any worklets that were delayed waiting for this
 *      element (legacy dynamic-component compat path).
 */
export function onWorkletCtxUpdate(
  worklet: WorkletLike,
  oldWorklet: WorkletLike | null | undefined,
  isFirstScreen: boolean,
  element: unknown,
): void {
  const w = impl();
  if (worklet._execId !== undefined) {
    w?._jsFunctionLifecycleManager?.addRef(worklet._execId, worklet);
  }
  if (isFirstScreen && oldWorklet) {
    w?._hydrateCtx(worklet, oldWorklet);
  }
  if (isFirstScreen) {
    w?._eventDelayImpl.runDelayedWorklet(worklet, element);
  }
}
