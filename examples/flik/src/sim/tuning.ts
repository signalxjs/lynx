/**
 * Physics constants.
 *
 * Plain numbers, exported individually and used as literals inside the
 * worklets — a `'main thread'` body can't reach a module-scope object at
 * runtime (SWC captures free identifiers into `_c` and JSON-serializes them,
 * so an imported binding arrives as `undefined`). Keeping them here documents
 * the tuning in one place even though the worklets inline the values; the
 * tests below import them, so a drift between the two is a test failure.
 */

/** Coulomb deceleration, px/s². Constant, so pucks stop crisply. */
export const FRICTION = 900;

/**
 * Secondary viscous drag, 1/s. Small — its job is to take the last of the
 * energy out of a slow drift, not to dominate the slide.
 */
export const DRAG = 0.6;

/** Wall restitution. Below 1 so a ricochet bleeds energy like a real cushion. */
export const WALL_BOUNCE = 0.72;

/** Disc-disc restitution. High: pucks on a slick surface barely absorb. */
export const RESTITUTION = 0.94;

/**
 * Speed below which a disc counts as still, px/s. Above the drift that
 * positional correction alone can induce, or a tight cluster would never
 * settle and the shot would never end.
 */
export const SLEEP_SPEED = 6;

/** Consecutive substeps under `SLEEP_SPEED` before a disc is asleep. */
export const SLEEP_FRAMES = 6;

/**
 * Fraction of an overlap resolved per substep. Under 1 deliberately —
 * correcting the whole overlap at once makes a crowded cluster jitter.
 */
export const CORRECTION = 0.8;

/**
 * Launch speed cap, px/s. Bounds the per-substep travel: at the 1/120 s
 * timestep this is 15 px, against a 28 px small-disc diameter, so nothing
 * tunnels through a wall. Head-on closing speed is twice that, which is why
 * `tick.mt.ts` scales substeps by the fastest disc on the board.
 */
export const MAX_LAUNCH_SPEED = 1800;
