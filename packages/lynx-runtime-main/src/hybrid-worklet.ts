/**
 * Hybrid worklet — combines a user worklet handler and a BG-side handler
 * into a single registration that fits Lynx's one-handler-per-slot rule.
 *
 * Registered ONCE at MT init under the stable id `__sigx_hybrid_dispatch__`
 * in upstream's `lynxWorkletImpl._workletMap`. When the slot machine sees a
 * slot with both a worklet and a BG sign, it asks `hybridCtx(worklet, sign)`
 * for the ctx to hand to `__AddEvent({ type: 'worklet', value })`.
 *
 * Lynx native dispatches via `runWorklet` → upstream's `transformWorklet`
 * walks the ctx and `_c`. It detects nested `_wkltId` (our `realCtx`) and
 * replaces it with the bound user-worklet callable. Our hybrid body then
 * just invokes it, then bridges to BG via the `Lynx.Sigx.PublishEvent`
 * channel that `bg-bridge.ts` listens on.
 */

import type { WorkletPlaceholder } from './worklet-events.js';

export const HYBRID_WORKLET_ID = '__sigx_hybrid_dispatch__';

interface HybridThis {
  _c: {
    /** After transformWorklet walks _c, this is the bound user worklet. */
    realCtx?: (event: unknown) => void;
    bgSign?: string;
  };
}

function hybridDispatch(this: HybridThis, event: unknown): void {
  if (this._c.realCtx) {
    try { this._c.realCtx(event); }
    catch (e) { console.log('[sigx-mt] hybrid worklet body threw:', String(e)); }
  }
  if (this._c.bgSign) bridgeToBg(this._c.bgSign, event);
}

interface JSContextLike {
  dispatchEvent?: (e: { type: string; data: string }) => void;
}
interface LynxLike {
  getJSContext?: () => JSContextLike;
}

function bridgeToBg(sign: string, event: unknown): void {
  const lynxObj = (globalThis as { lynx?: LynxLike }).lynx;
  if (!lynxObj) {
    console.log('[sigx-mt] bridgeToBg: globalThis.lynx is undefined');
    return;
  }
  const ctx = lynxObj.getJSContext?.();
  if (!ctx) {
    console.log('[sigx-mt] bridgeToBg: lynx.getJSContext() returned', typeof ctx);
    return;
  }
  if (!ctx.dispatchEvent) {
    console.log('[sigx-mt] bridgeToBg: jsContext has no dispatchEvent', Object.keys(ctx as object).join(','));
    return;
  }
  let data: string;
  try { data = JSON.stringify({ sign, event }); }
  catch (e) {
    console.log('[sigx-mt] bridgeToBg: JSON.stringify failed', String(e));
    return;
  }
  console.log('[sigx-mt] bridgeToBg: dispatching to BG, sign=', sign);
  ctx.dispatchEvent({ type: 'Lynx.Sigx.PublishEvent', data });
}

/**
 * Install the hybrid worklet into upstream's worklet map. Must be called
 * AFTER the @lynx-js/react/worklet-runtime IIFE has populated
 * globalThis.lynxWorkletImpl. Idempotent — safe to call across hot reloads.
 */
export function installHybridWorklet(): void {
  const impl = (globalThis as { lynxWorkletImpl?: { _workletMap: Record<string, Function> } })
    .lynxWorkletImpl;
  if (impl) impl._workletMap[HYBRID_WORKLET_ID] = hybridDispatch as Function;
}

/** Build the ctx for a hybrid registration. */
export function hybridCtx(realCtx: WorkletPlaceholder, bgSign: string): {
  _wkltId: string;
  _workletType: 'main-thread';
  _c: { realCtx: WorkletPlaceholder; bgSign: string };
} {
  return {
    _wkltId: HYBRID_WORKLET_ID,
    _workletType: 'main-thread',
    _c: { realCtx, bgSign },
  };
}
