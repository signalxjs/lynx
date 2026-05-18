/**
 * BG-side listener for the MT→BG `Lynx.Sigx.PublishEvent` channel.
 *
 * The MT-side hybrid worklet (`lynx-runtime-main/src/hybrid-worklet.ts`) calls
 * `lynx.getJSContext().dispatchEvent({ type: 'Lynx.Sigx.PublishEvent', data })`
 * to fire the BG handler whose sign is captured in the hybrid ctx. We listen
 * for that event here and route through the existing event-registry's
 * `publishEvent` — the same dispatcher Lynx native calls when a normal
 * `bindtap` fires on BG. The user's BG handler runs in the same call-stack
 * shape it always has, so signal updates / `count.value++` etc. work without
 * any awareness that the trigger came from MT.
 *
 * Side-effect import from `index.ts` so the listener is wired before any
 * user code runs.
 *
 * CROSS-THREAD ASYMMETRY (per @lynx-js/react/runtime/lib/worklet/call/runOnBackground.js):
 *   - MT → BG dispatch: MT calls `lynx.getJSContext().dispatchEvent(...)`,
 *     BG listens via `lynx.getCoreContext().addEventListener(...)`.
 *   - BG → MT dispatch: BG calls `lynx.getCoreContext().dispatchEvent(...)`,
 *     MT listens via `lynx.getJSContext().addEventListener(...)`.
 * Each side calls a DIFFERENT method to reach the other thread — they're not
 * symmetric. Listening on `lynx.getJSContext()` from BG just listens on BG's
 * own context (no cross-thread events arrive).
 *
 * `lynx` is closure-injected by RuntimeWrapperWebpackPlugin (declared in
 * shims.d.ts). It is NOT available as `globalThis.lynx` — use the free
 * identifier directly.
 */

import { publishEvent } from './event-registry';
import { ingestAvPublishes } from './animated-bridge';

interface JSContextLike {
  addEventListener?: (
    type: string,
    listener: (e: { data: string }) => void,
  ) => void;
}

const lynxObj: { getCoreContext?: () => JSContextLike } | undefined =
  typeof lynx !== 'undefined'
    ? (lynx as unknown as { getCoreContext?: () => JSContextLike })
    : undefined;
const ctx: JSContextLike | undefined = lynxObj?.getCoreContext?.();

if (ctx?.addEventListener) {
  ctx.addEventListener('Lynx.Sigx.PublishEvent', (e: { data: string }) => {
    let payload: { sign?: string; event?: unknown };
    try {
      payload = JSON.parse(e.data) as { sign?: string; event?: unknown };
    } catch {
      return; // malformed bridge message — drop
    }
    if (typeof payload.sign === 'string') {
      publishEvent(payload.sign, payload.event);
    }
  });

  // SharedValue bridge: each event payload is an array of
  // `[wvid, value]` tuples coalesced from one MT flush window. See
  // `animated-bridge.ts` and `@sigx/lynx-runtime-main/animated-bridge-mt.ts`.
  ctx.addEventListener('Lynx.Sigx.AvPublish', (e: { data: string }) => {
    let updates: Array<[number, unknown]>;
    try {
      updates = JSON.parse(e.data) as Array<[number, unknown]>;
    } catch {
      return;
    }
    if (Array.isArray(updates)) {
      ingestAvPublishes(updates);
    }
  });
}

export {};
