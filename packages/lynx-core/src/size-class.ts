import { computed, type Computed } from '@sigx/reactivity';
import { useScreen, useScreenMT, type ScreenMetrics } from './screen.js';

/**
 * Window size classes — the coarse "how much room do I have" reads layout
 * branches on (#1013).
 *
 * Derived entirely from {@link useScreen}, so there is no second native
 * subscription and no new publisher: the same `ScreenMetricsPublisher` that
 * follows rotation, iPad Split View / Stage Manager and foldable unfold drives
 * these too.
 *
 * **Why a separate read from `useScreen()`.** `useScreen()` changes on every
 * pixel, so a layout that branches on it re-renders continuously while a Stage
 * Manager divider is dragged. Everything here is bucketed or boolean, and
 * sigx's `computed()` only propagates when the new value isn't `Object.is`-equal
 * to the old — so `useWidthAtLeast(840)` fires exactly once, as the threshold is
 * crossed, and never during a drag within one bucket. Reach for `useScreen()`
 * when you genuinely need the pixel value (column-count math); reach for these
 * when you need a layout decision.
 *
 * **Breakpoint values** are Material's (600 / 840 / 1200 / 1600 dp wide,
 * 480 / 900 dp tall) — the one widely-used set expressed in
 * density-independent units and derived from real device sizes rather than
 * desktop browser windows. Lynx lengths are already logical px (dp on Android,
 * pt on iOS), so the numbers transfer exactly. They are exported as plain
 * constants, and every predicate takes an arbitrary `dp`, so an app that wants
 * its own threshold is a first-class citizen.
 *
 * **Predicates, not enum equality.** Compose shipped `widthSizeClass ==
 * Compact` first and broke every call site when Large and Extra-Large were
 * added later. `useWidthAtLeast(dp)` is monotone, so widening the bucket list
 * can never silently change what an existing call means.
 */

/**
 * Breakpoint thresholds in logical px (dp/pt) — the lower bound of each
 * bucket. Pass them to {@link useWidthAtLeast} / {@link useHeightAtLeast}, or
 * compare against `useScreenMT().width` inside a `'main thread'` worklet.
 */
export const Breakpoint = {
    /** ≥600dp — large phone landscape, small tablet portrait. */
    WIDTH_MEDIUM: 600,
    /** ≥840dp — tablet portrait (iPad Air 13 portrait is 1024). */
    WIDTH_EXPANDED: 840,
    /** ≥1200dp — tablet landscape (iPad Air 13 landscape is 1366). */
    WIDTH_LARGE: 1200,
    /** ≥1600dp — desktop-class windows. */
    WIDTH_XLARGE: 1600,
    /** ≥480dp tall. Below this is a phone in landscape. */
    HEIGHT_MEDIUM: 480,
    /** ≥900dp tall. */
    HEIGHT_EXPANDED: 900,
} as const;

/** Coarse width bucket. Mobile-first: `compact` is the base case. */
export type WidthClass = 'compact' | 'medium' | 'expanded' | 'large' | 'xlarge';

/**
 * Coarse height bucket. Worth branching on independently of width: a phone in
 * landscape has plenty of width and a `compact` height, which is exactly the
 * case a width-only rule gets wrong (it puts a vertical rail on a 390dp-tall
 * screen).
 */
export type HeightClass = 'compact' | 'medium' | 'expanded';

/** Bucket a logical width. Exported for tests and for MT/off-signal callers. */
export function widthClassOf(width: number): WidthClass {
    if (width >= Breakpoint.WIDTH_XLARGE) return 'xlarge';
    if (width >= Breakpoint.WIDTH_LARGE) return 'large';
    if (width >= Breakpoint.WIDTH_EXPANDED) return 'expanded';
    if (width >= Breakpoint.WIDTH_MEDIUM) return 'medium';
    return 'compact';
}

/** Bucket a logical height. Exported for tests and for MT/off-signal callers. */
export function heightClassOf(height: number): HeightClass {
    if (height >= Breakpoint.HEIGHT_EXPANDED) return 'expanded';
    if (height >= Breakpoint.HEIGHT_MEDIUM) return 'medium';
    return 'compact';
}

// Memoized per distinct threshold, mirroring the module-singleton approach
// `screen.ts` takes for `useScreen()` / `useOrientation()`.
//
// This is not a micro-optimization: `computed()` exposes no disposer, and a
// dep's subscriber set holds strong references, so a computed created per hook
// call would stay linked to the screen signal for the life of the process —
// one leaked entry per component instance ever mounted. Keying by threshold
// bounds the set at the number of distinct dp values the app actually uses
// (in practice the six `Breakpoint` constants), so `dp` should be a constant,
// not a value derived per render.
const widthAtLeastCache = new Map<number, Computed<boolean>>();
const heightAtLeastCache = new Map<number, Computed<boolean>>();
let widthClassComputed: Computed<WidthClass> | undefined;
let heightClassComputed: Computed<HeightClass> | undefined;

/**
 * BG-side reactive width bucket. Re-fires only when the bucket changes, never
 * on a raw pixel move within one.
 *
 * @example
 * ```tsx
 * const w = useWidthClass();
 * return () => <view class={w.value === 'compact' ? 'flex-col' : 'flex-row'} />;
 * ```
 */
export function useWidthClass(): Computed<WidthClass> {
    // Call `useScreen()` on EVERY call, not just the memo miss: it is what runs
    // `ensureWired()`, whose retry-on-a-later-call is the only thing that
    // recovers a first read which raced runtime init (there was no emitter to
    // subscribe to yet). Hoisting it inside the guard would latch that retry
    // away, and an app that only ever calls these hooks — never `useScreen()`
    // directly — would sit on the cold-start seed for the whole session.
    const screen = useScreen();
    if (!widthClassComputed) {
        widthClassComputed = computed(() => widthClassOf(screen.value.width));
    }
    return widthClassComputed;
}

/** BG-side reactive height bucket. See {@link HeightClass}. */
export function useHeightClass(): Computed<HeightClass> {
    const screen = useScreen();
    if (!heightClassComputed) {
        heightClassComputed = computed(() => heightClassOf(screen.value.height));
    }
    return heightClassComputed;
}

/**
 * BG-side reactive "is the window at least `dp` wide?". The primary read for
 * layout branches — it flips exactly once, as the threshold is crossed.
 *
 * `dp` is compared against the real width, so any threshold is exact; it is
 * not snapped to a bucket. Pass a constant (see the caching note above).
 *
 * @example
 * ```tsx
 * const isWide = useWidthAtLeast(Breakpoint.WIDTH_EXPANDED);
 * return () => (isWide.value ? <SidebarLayout /> : <StackedLayout />);
 * ```
 */
export function useWidthAtLeast(dp: number): Computed<boolean> {
    // Unconditional, for the `ensureWired()` retry — see `useWidthClass()`.
    const screen = useScreen();
    let c = widthAtLeastCache.get(dp);
    if (!c) {
        c = computed(() => screen.value.width >= dp);
        widthAtLeastCache.set(dp, c);
    }
    return c;
}

/**
 * BG-side reactive "is the window at least `dp` tall?".
 *
 * Pair this with {@link useWidthAtLeast} when the decision is about an
 * affordance that eats vertical space — a phone in landscape is wide and
 * short, and deserves the compact treatment.
 */
export function useHeightAtLeast(dp: number): Computed<boolean> {
    // Unconditional, for the `ensureWired()` retry — see `useWidthClass()`.
    const screen = useScreen();
    let c = heightAtLeastCache.get(dp);
    if (!c) {
        c = computed(() => screen.value.height >= dp);
        heightAtLeastCache.set(dp, c);
    }
    return c;
}

/**
 * MT-thread synchronous width bucket, for `'main thread'`-marked worklet
 * bodies. Reads `lynx.__globalProps` directly — no subscription, so it
 * re-evaluates per worklet invocation against the current viewport.
 *
 * There is deliberately no `useWidthAtLeastMT(dp)`: a worklet already has the
 * number, so write `useScreenMT().width >= Breakpoint.WIDTH_EXPANDED`.
 */
export function useWidthClassMT(): WidthClass {
    const metrics: ScreenMetrics = useScreenMT();
    return widthClassOf(metrics.width);
}

/** MT-thread synchronous height bucket. See {@link useWidthClassMT}. */
export function useHeightClassMT(): HeightClass {
    const metrics: ScreenMetrics = useScreenMT();
    return heightClassOf(metrics.height);
}
