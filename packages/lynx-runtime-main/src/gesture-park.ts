/**
 * Parked gesture registrations (#958).
 *
 * `SET_GESTURE_DETECTOR` needs the bound element, and the element is bound by
 * `SET_MT_REF`. Ordinarily the ref op comes first — the JSX that carries
 * `main-thread:ref` mounts before the component's `onMounted` fires — so the
 * lookup succeeds and none of this runs.
 *
 * It does NOT hold when the detector is registered by a component that mounts
 * EARLIER than the element it binds to. A screen that measures itself before
 * rendering its content is the ordinary way to hit this: the detector's owner
 * mounts, pushes its registration, and the target element only appears a frame
 * or two later once a layout event has arrived.
 *
 * Before this existed the handler simply gave up on the unresolved element.
 * The op was pushed, the ops stream was well-formed, nothing threw on either
 * thread — and the gesture was permanently dead. There was no warning, no
 * retry, and no way to tell it apart from a gesture that had never been
 * written, which is what made it expensive to find (a full device-debug
 * session on `examples/flik`).
 *
 * Parking mirrors what the snapshot runtime already does for ops that arrive
 * before their instance materializes (`snapshot-mt.ts`'s parked creates): hold
 * the registration, and drain it the moment the element it wants shows up.
 */

/** Wire shape of a gesture's callbacks and config. */
export interface GestureWireConfig {
  callbacks: { name: string; callback: Record<string, unknown> }[];
  config?: Record<string, unknown>;
}

/** Wire shape of a gesture's relations to its siblings. */
export interface GestureWireRelations {
  waitFor: number[];
  simultaneous: number[];
  continueWith: number[];
}

/** A registration waiting for its element to be bound. */
export interface ParkedGesture {
  elementWvid: number;
  gestureId: number;
  type: number;
  config: GestureWireConfig;
  relationMap: GestureWireRelations;
}

/** elementWvid → registrations waiting on it, in arrival order. */
const parked = new Map<number, ParkedGesture[]>();

/**
 * Hold a registration until its element binds.
 *
 * Order within an element is preserved: a composed gesture arrives as several
 * ops whose relations reference each other by id, so replaying them out of
 * order would rebuild a different arena.
 */
export function parkGesture(entry: ParkedGesture): void {
  let list = parked.get(entry.elementWvid);
  if (!list) {
    list = [];
    parked.set(entry.elementWvid, list);
  }
  list.push(entry);
}

/**
 * How a parked registration is installed once its element exists. Supplied by
 * `ops-apply`, which owns the registration logic.
 *
 * Injected rather than imported because the drain has to live in
 * `bindMtRef` — the one place BOTH binding paths go through — and importing
 * `ops-apply` from there would be a cycle.
 */
type ApplyFn = (entry: ParkedGesture) => boolean;
let applyImpl: ApplyFn | null = null;

/** Wire up the installer. Called once at module init by `ops-apply`. */
export function setGestureApplier(fn: ApplyFn): void {
  applyImpl = fn;
}

/**
 * Apply everything waiting on `elementWvid`, in arrival order, and forget it.
 *
 * Called from `bindMtRef`, NOT from the `SET_MT_REF` op handler. That
 * distinction is the whole point: elements inside a compiled snapshot template
 * bind their refs through the snapshot runtime, which calls `bindMtRef`
 * directly and never emits a `SET_MT_REF` op. Draining from the op handler
 * therefore missed every ref in a snapshot subtree — which, since the compiler
 * is on by default, is most of them.
 */
export function drainParkedGestures(elementWvid: number): void {
  const list = parked.get(elementWvid);
  if (!list) return;
  parked.delete(elementWvid);
  const apply = applyImpl;
  if (!apply) return;
  for (const entry of list) apply(entry);
}

/**
 * Forget a parked registration because it was removed before it ever applied.
 *
 * A detector whose component unmounts during the same window it was parked in
 * emits its REMOVE while the SET is still waiting. Without this the REMOVE
 * would find nothing to remove and the stale SET would install a gesture for a
 * component that no longer exists, the moment the element bound.
 */
export function dropParkedGesture(elementWvid: number, gestureId: number): boolean {
  const list = parked.get(elementWvid);
  if (!list) return false;
  const at = list.findIndex((g) => g.gestureId === gestureId);
  if (at === -1) return false;
  list.splice(at, 1);
  if (list.length === 0) parked.delete(elementWvid);
  return true;
}

/**
 * Registrations still waiting.
 *
 * Deliberately a counter rather than a warning: parking is now a NORMAL,
 * handled path, so logging every time would be noise on every screen whose
 * detector mounts ahead of its element. What remains invisible is a
 * registration that is parked and never drained because the element never
 * binds at all — this is the seam for a caller (or a test) that wants to
 * assert none are outstanding.
 */
export function parkedGestureCount(): number {
  let n = 0;
  for (const list of parked.values()) n += list.length;
  return n;
}

export function resetParkedGestures(): void {
  parked.clear();
}
