/**
 * Op queue — accumulates renderer ops on the Background Thread and flushes
 * them to the Main Thread via the Lynx host bridge.
 *
 * The bridge identifiers `lynx` and `lynxCoreInject` are NOT on globalThis.
 * They are injected as closure parameters by RuntimeWrapperWebpackPlugin
 * (peer dep `@lynx-js/runtime-wrapper-webpack-plugin`), which wraps the BG
 * bundle in `__init_card_bundle__(lynxCoreInject, lynx, ...)`. Once wrapped,
 * any module in the bundle can reference them as bare identifiers.
 *
 */

export { OP } from '@sigx/lynx-runtime-internal';

// ---------------------------------------------------------------------------
// Ambient declarations for the closure-injected host bridge identifiers
// ---------------------------------------------------------------------------

// `lynx` and `lynxCoreInject` are declared in src/shims.d.ts as the
// single source of truth for closure-injected identifiers from
// runtime-wrapper-webpack-plugin. Both are typed as `any` since their
// shape varies by host — call sites guard with typeof checks.

// ---------------------------------------------------------------------------
// Op buffer
// ---------------------------------------------------------------------------

let buffer: unknown[] = [];

/**
 * Push one op (opcode + arguments) into the buffer as a flat sequence.
 * Example: pushOp(OP.CREATE, id, type) → buffer gets [0, id, type].
 */
export function pushOp(...args: unknown[]): void {
  for (const arg of args) {
    buffer.push(arg);
  }
}

/** Take all buffered ops and reset the buffer. */
export function takeOps(): unknown[] {
  const b = buffer;
  buffer = [];
  return b;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

let scheduled = false;

/**
 * Schedule a flush of the ops buffer at the end of the current microtask.
 * Multiple calls within one tick are coalesced into one cross-thread call.
 */
export function scheduleFlush(): void {
  if (scheduled) return;
  scheduled = true;
  Promise.resolve().then(doFlush);
}

/**
 * Immediately flush all buffered ops — used on initial mount so the first
 * frame is committed synchronously.
 */
export function flushNow(): void {
  scheduled = false;
  const ops = takeOps();
  if (ops.length === 0) return;
  sendOps(ops);
}

/** Reset module state — for testing only. */
export function resetOpQueue(): void {
  buffer = [];
  scheduled = false;
  pendingAckPromise = null;
}

function doFlush(): void {
  scheduled = false;
  const ops = takeOps();
  if (ops.length === 0) return;
  sendOps(ops);
}

// ---------------------------------------------------------------------------
// Main-thread ack tracking
//
// callLepusMethod is asynchronous: by the time the BG flush cycle finishes,
// the MT has not yet applied the ops. Track a promise that resolves when the
// MT acks via the callback so callers can `await waitForFlush()` if they need
// to coordinate with the next-tick UI state.
// ---------------------------------------------------------------------------

let pendingAckPromise: Promise<void> | null = null;

/**
 * Resolves once the most recent ops batch has been applied on the main
 * thread. If no ops are in flight, resolves immediately.
 *
 * Acks are tracked PER BATCH (each sendOps call closes over its own
 * resolver): with several batches in flight, an earlier batch's ack can
 * never resolve a later batch's promise (#691 review). `pendingAckPromise`
 * only tracks which promise is the newest for callers arriving here.
 */
export function waitForFlush(): Promise<void> {
  return pendingAckPromise ?? Promise.resolve();
}

/**
 * Whether renderer work is still in flight toward the Main Thread: buffered
 * ops awaiting their microtask flush, a scheduled-but-unsent flush, or a sent
 * batch whose MT ack hasn't arrived (batches ack in order, so the newest
 * batch's ack — tracked by `pendingAckPromise` — covers the older ones).
 * `false` means the MT has applied everything the BG has emitted so far.
 *
 * Callers that stage work behind a quiescence point poll this between flush
 * waits — e.g. lynx-navigation's pre-stage transition window (#651), which
 * holds a push animation until the incoming screen's mount and post-mount
 * flushes have all been applied.
 */
export function pendingOps(): boolean {
  return buffer.length > 0 || scheduled || pendingAckPromise !== null;
}

// ---------------------------------------------------------------------------
// Transport (BG → MT)
// ---------------------------------------------------------------------------

function sendOps(ops: unknown[]): void {
  const data = JSON.stringify(ops);

  // Create the ack promise BEFORE sending so any waitForFlush() chained
  // immediately after this call observes the in-flight batch. The resolver
  // is a LOCAL closed over by this batch's callback only — an earlier
  // batch's ack must never resolve a later batch's promise.
  let resolveThisBatch!: () => void;
  const thisBatchAck = new Promise<void>((resolve) => {
    resolveThisBatch = resolve;
  });
  pendingAckPromise = thisBatchAck;
  const settle = (): void => {
    resolveThisBatch();
    if (pendingAckPromise === thisBatchAck) pendingAckPromise = null;
  };

  // Primary path: closure-injected `lynx` from RuntimeWrapperWebpackPlugin.
  if (typeof lynx !== 'undefined') {
    const app = lynx?.getNativeApp?.();
    if (app && typeof app.callLepusMethod === 'function') {
      app.callLepusMethod('sigxPatchUpdate', { data }, settle);
      return;
    }
  }

  // Same-thread fallback for unit tests where BG and MT share globalThis.
  const g = globalThis as Record<string, unknown>;
  if (typeof g['sigxPatchUpdate'] === 'function') {
    (g['sigxPatchUpdate'] as Function)({ data });
    settle();
    return;
  }

  // No bridge available — drop and resolve so callers don't hang. This path
  // indicates the bundle wasn't wrapped by RuntimeWrapperWebpackPlugin.
  console.log(
    '[sigx-bg] sendOps: no `lynx` global injected — bundle is missing RuntimeWrapperWebpackPlugin',
  );
  settle();
}

// ---------------------------------------------------------------------------
// Hot reload signal (BG → MT)
//
// Sent before a webpack HMR update replaces the BG module, so the MT resets
// its element registry and page root before the new ops batch arrives.
// ---------------------------------------------------------------------------

/**
 * Tell the Main Thread to reset its element tree in preparation for a hot
 * reload. The MT handler (`sigxHotReload`) calls `resetMainThreadState()`,
 * re-creates the page root, and flushes — so the next `sigxPatchUpdate`
 * batch builds on a clean tree.
 *
 * This is fire-and-forget: callLepusMethod messages are ordered, so
 * sigxHotReload will be processed before any subsequent sigxPatchUpdate.
 */
export function sendHotReloadSignal(): void {
  // Primary path: closure-injected `lynx` from RuntimeWrapperWebpackPlugin.
  if (typeof lynx !== 'undefined') {
    const app = lynx?.getNativeApp?.();
    if (app && typeof app.callLepusMethod === 'function') {
      app.callLepusMethod('sigxHotReload', {}, () => {});
      return;
    }
  }

  // Same-thread fallback for testing where BG and MT share globalThis.
  const g = globalThis as Record<string, unknown>;
  if (typeof g['sigxHotReload'] === 'function') {
    (g['sigxHotReload'] as Function)();
  }
}

// ---------------------------------------------------------------------------
// Event dispatch (MT → BG)
//
// The Lynx host calls `lynxCoreInject.tt.publishEvent(sign, data)` (and
// `publicComponentEvent(cid, sign, data)`) when an event fires on the
// Main Thread. We install our dispatcher there once at module load.
// ---------------------------------------------------------------------------

/**
 * Look up a sign in __SIGX_LYNX_EVENT_REGISTRY__ and invoke the registered
 * handler. The registry is populated by lynx-runtime's patchProp branch
 * whenever the renderer sees a `bindtap` / `onTap` / etc. prop.
 */
function dispatchEvent(sign: unknown, evt: unknown): void {
  try {
    const registry = (globalThis as any).__SIGX_LYNX_EVENT_REGISTRY__;
    if (!registry?.handlers || sign == null) return;
    const handlers = registry.handlers;
    const fn = handlers instanceof Map
      ? handlers.get(String(sign))
      : handlers[String(sign)];
    if (typeof fn === 'function') fn(evt);
  } catch (e) {
    console.log('[sigx-bg] event dispatch threw:', String(e));
  }
}

/**
 * Install our event dispatcher on `lynxCoreInject.tt` — the official place
 * the Lynx host calls when it forwards Main Thread events to the BG.
 *
 * Idempotent. Called from render.ts on module load and from lynxMount() as
 * a defensive re-install in case the host swaps the tt namespace between
 * card loads.
 */
export function installEventPublisher(): void {
  // Primary install path — the canonical Lynx integration point.
  if (typeof lynxCoreInject !== 'undefined' && lynxCoreInject?.tt) {
    lynxCoreInject.tt.publishEvent = dispatchEvent;
    lynxCoreInject.tt.publicComponentEvent = (
      _cid: string,
      sign: string,
      data: unknown,
    ) => dispatchEvent(sign, data);
  }

  // Fallback for older Lynx SDKs that look at globalThis.publishEvent.
  const g = globalThis as Record<string, unknown>;
  if (typeof g['publishEvent'] !== 'function') {
    g['publishEvent'] = dispatchEvent as (...args: unknown[]) => void;
  }
  if (typeof g['publicComponentEvent'] !== 'function') {
    g['publicComponentEvent'] = ((_cid: string, sign: string, data: unknown) =>
      dispatchEvent(sign, data)) as (...args: unknown[]) => void;
  }
}
