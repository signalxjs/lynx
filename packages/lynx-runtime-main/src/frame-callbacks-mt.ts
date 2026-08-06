/**
 * MT-side frame-callback registry and driver (#933).
 *
 * ONE `requestAnimationFrame` chain drives every registered callback. The
 * alternative — a chain per callback, the way `lynx-motion`'s `animate()`
 * works — was rejected because `requestAnimationFrame` on the main thread is
 * a host bridge call, so N chains means N bridge calls per frame for no
 * benefit. A single chain also gives every callback in a frame the same
 * `Date.now()` sample (two simulations can't disagree about "now"), closes
 * the frame with one flush, and puts "stop chaining when nothing is active"
 * in one place — which is the only mechanism that actually stops a loop,
 * since `cancelAnimationFrame` is not dependable here.
 *
 * ### The hydration cache is the whole design
 *
 * Upstream's `runWorklet(ctx, args)` memoizes its `_c` walk in a `WeakMap`
 * keyed on the ctx object's IDENTITY. So each entry rebuilds its prototype
 * ONCE at registration and then hands `runWorklet` the SAME object every
 * frame: subsequent frames cost a bound-function call and nothing else. Build
 * a fresh ctx per frame (what `invokeMtWorklet` does, correctly, for one-shot
 * dispatches) and every frame instead pays a full `_c` walk, a new `WeakRef`,
 * and — for any `runOnBackground` handle in the body — another
 * `addRef(execId, …)` into upstream's `FinalizationRegistry`, climbing its
 * refcount forever. The `ctx identity` test pins this.
 */

import { rebuildWithObjectPrototype } from './mt-invoke.js';
import { scheduleAvFlush } from './animated-bridge-mt.js';

interface WorkletCtx {
  _wkltId: string;
  _c?: Record<string, unknown>;
  [key: string]: unknown;
}

interface WorkletImpl {
  _refImpl?: {
    _workletRefMap: Record<number, unknown>;
  };
}

interface FrameEntry {
  id: number;
  /** Prototype-rebuilt ONCE; its identity is upstream's hydration cache key. */
  ctx: WorkletCtx;
  active: boolean;
  /** `Date.now()` at the current run's activation. */
  startedAt: number;
  /** `Date.now()` of the previous tick, or 0 before this run's first frame. */
  lastAt: number;
  frameNumber: number;
  /** Consecutive throws, for log rate-limiting. Reset by a clean frame. */
  errors: number;
  /** Whether the one-time capture-resolution check has passed. */
  hydrationChecked: boolean;
  /** Frames spent waiting for a capture to appear in the ref map. */
  waitedFrames: number;
}

/** Frames to wait for an unresolved capture before running anyway. */
const CAPTURE_GRACE_FRAMES = 60;
/** Log at most one message per this many consecutive throwing frames. */
const ERROR_LOG_INTERVAL = 60;

const entries = new Map<number, FrameEntry>();
let activeCount = 0;
/** Whether a tick is already queued — the chain must never fork. */
let chained = false;
/**
 * Bumped by {@link resetFrameCallbacks}. A tick queued before a reset carries
 * the old generation and retires itself instead of running against the new
 * registry — which is what lets the reset clear `chained` (so the driver still
 * works after an HMR reload) without the stale tick then forking the chain.
 */
let generation = 0;

/**
 * Register a frame callback. `rawCtx` arrives straight off the wire, so its
 * objects have a null prototype under PrimJS; rebuilding is mandatory before
 * upstream's walker can `new WeakRef(...)` it. It happens exactly once —
 * see the hydration-cache note at the top of this file.
 */
export function registerFrameCallback(id: number, rawCtx: unknown, active: boolean): void {
  const ctx = rebuildWithObjectPrototype(rawCtx) as WorkletCtx;
  entries.set(id, {
    id,
    ctx,
    active: false,
    startedAt: 0,
    lastAt: 0,
    frameNumber: 0,
    errors: 0,
    hydrationChecked: false,
    waitedFrames: 0,
  });
  if (active) setFrameCallbackActive(id, true);
}

/**
 * Activate or deactivate a callback. Idempotent: a gesture that hammers
 * `startFrameCallback` on every `onUpdate` must not restart the run and reset
 * its `dt` to 0 each time.
 *
 * Also installed on `globalThis.__sigxFrameCallbacks` (entry-main.ts) so the
 * `startFrameCallback` / `stopFrameCallback` worklets can reach it.
 */
export function setFrameCallbackActive(id: number, active: boolean): void {
  const entry = entries.get(id);
  if (!entry || entry.active === active) return;
  entry.active = active;
  if (active) {
    entry.startedAt = Date.now();
    entry.lastAt = 0;
    entry.frameNumber = 0;
    entry.errors = 0;
    activeCount++;
    schedule();
  } else {
    activeCount--;
    // No cancel: the already-queued tick runs, finds nothing active, and
    // declines to reschedule.
  }
}

export function unregisterFrameCallback(id: number): void {
  const entry = entries.get(id);
  if (!entry) return;
  if (entry.active) activeCount--;
  entries.delete(id);
}

export function resetFrameCallbacks(): void {
  entries.clear();
  activeCount = 0;
  // Retire any tick already queued with the host and release the latch. Both
  // halves are needed: without the generation bump the stale tick would run
  // against the new registry and fork the chain; without clearing `chained`
  // the driver would be permanently wedged after a reset, since no future
  // activation could ever queue a tick.
  generation++;
  chained = false;
}

/** Test seam, mirroring `derivedValueCount()`. */
export function frameCallbackCount(): number {
  return entries.size;
}

function schedule(): void {
  if (chained || activeCount === 0) return;
  chained = true;
  const gen = generation;
  const run = (): void => {
    // Retired by a reset while queued: return WITHOUT clearing `chained`, so
    // a chain started after the reset isn't forked.
    if (gen !== generation) return;
    tick();
  };
  const g = globalThis as { requestAnimationFrame?: (cb: () => void) => unknown };
  if (typeof g.requestAnimationFrame === 'function') {
    try {
      g.requestAnimationFrame(run);
      return;
    } catch {
      // Upstream THROWS rather than being absent on Lynx SDK < 2.16
      // ("requestAnimationFrame in main thread script requires Lynx sdk
      // version 2.16"), so a `typeof` check alone is not enough of a guard.
      // Fall through to the timer.
    }
  }
  setTimeout(run, 16);
}

/**
 * Resolve-once hazard: upstream's `_c` walker OVERWRITES each `{_wvid}`
 * placeholder in place with whatever the ref map holds at that moment, and
 * the ctx is cached, so a capture hydrated before its `INIT_MT_REF` landed
 * would be `undefined` FOREVER with no way to self-heal. Skipping the frame
 * is what preserves the placeholder for a later, successful hydration.
 *
 * In practice captures are lexical, so their `INIT_MT_REF` rides the same
 * batch or an earlier one and the first tick passes immediately. The grace
 * window makes that an enforced invariant instead of an assumption.
 */
function capturesResolvable(entry: FrameEntry): boolean {
  const captured = entry.ctx._c;
  const impl = (globalThis as { lynxWorkletImpl?: WorkletImpl }).lynxWorkletImpl;
  const refMap = impl?._refImpl?._workletRefMap;
  if (captured && refMap) {
    for (const key of Object.keys(captured)) {
      const value = captured[key] as { _wvid?: number } | null;
      if (
        value
        && typeof value === 'object'
        && typeof value._wvid === 'number'
        && !(value._wvid in refMap)
      ) {
        if (++entry.waitedFrames < CAPTURE_GRACE_FRAMES) return false;
        console.log(
          '[sigx-mt] frame callback', entry.id, 'capture _wvid', value._wvid,
          'never registered — running with an undefined capture',
        );
        break;
      }
    }
  }
  entry.hydrationChecked = true;
  return true;
}

function tick(): void {
  chained = false;
  if (activeCount === 0) return;

  const runWorklet = (globalThis as Record<string, unknown>)['runWorklet'] as
    | ((ctx: WorkletCtx, args: unknown[]) => unknown)
    | undefined;
  if (typeof runWorklet !== 'function') {
    // Upstream's worklet runtime hasn't installed its invoker yet (or this
    // host has none). Keep the chain alive so a callback registered during
    // bootstrap still starts, but advance NOTHING — counting a frame we
    // couldn't invoke would rob the first real invocation of its documented
    // `frameNumber: 1` / `timeSincePreviousFrame: 0`, and would flush a tree
    // nothing touched.
    schedule();
    return;
  }

  const now = Date.now();
  let ran = false;

  // Map iteration tolerates deletion mid-loop; an entry activated by an
  // earlier callback in this same frame is visited this frame, which is what
  // you want.
  for (const entry of entries.values()) {
    if (!entry.active) continue;
    if (!entry.hydrationChecked && !capturesResolvable(entry)) continue;
    ran = true;

    const dt = entry.lastAt === 0 ? 0 : Math.max(0, now - entry.lastAt);
    entry.lastAt = now;
    entry.frameNumber++;

    try {
      runWorklet(entry.ctx, [{
        timestamp: now,
        timeSinceFirstFrame: Math.max(0, now - entry.startedAt),
        timeSincePreviousFrame: dt,
        frameNumber: entry.frameNumber,
      }]);
      entry.errors = 0;
    } catch (e) {
      // Rate-limited: a body that throws at 60fps would emit 60 identical
      // lines a second and bury everything else. Not auto-stopped — killing
      // a loop the caller started, silently, is the worse failure mode.
      if (entry.errors % ERROR_LOG_INTERVAL === 0) {
        console.log('[sigx-mt] frame callback threw:', entry.id, String(e));
      }
      entry.errors++;
    }
  }

  // Shares the `__sigxMotionFlushScheduled` latch with SharedValue writes and
  // motion ticks, so a frame that did both still flushes the tree exactly
  // once. Callbacks that only wrote SVs would have scheduled this anyway;
  // this covers the ones that mutated elements directly.
  if (ran) scheduleAvFlush();

  schedule();
}

// ---------------------------------------------------------------------------
// Worklet-callable activation
//
// `startFrameCallback` / `stopFrameCallback` (@sigx/lynx-runtime) are
// `'main thread'` worklets whose bodies reach this global — it has to be a
// global for the same reason `runOnBackground` does: SWC captures free
// identifiers into `_c` and JSON-serializes them, so an imported function
// reference would arrive as `undefined`. This is what lets a gesture's onEnd
// start a simulation in the frame the finger lifts, with no BG round trip.
//
// Installed here rather than in `entry-main.ts` so it can never be missing
// while the op handlers that create the entries are live: this module IS the
// registry, and anything that can register a callback can already reach it.
// ---------------------------------------------------------------------------
(globalThis as Record<string, unknown>)['__sigxFrameCallbacks'] = {
  setActive: setFrameCallbackActive,
};
