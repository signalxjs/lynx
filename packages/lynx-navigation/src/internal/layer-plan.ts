/**
 * Pure layer-plan computation for `<Stack>`'s render.
 *
 * Given (stack, transition, progress), produces an ordered list of
 * `Layer`s — each is an entry to render plus an optional transform
 * spec for animation. The Stack render emits one absolutely-positioned
 * `<view>` per layer, stacked bottom-to-top in document order.
 *
 * Why this is its own module: the layer-selection logic is the only
 * non-obvious part of the navigator's render path, and the rules are
 * easier to read (and unit-test) as a pure function over the
 * navigator's state than as inline render branches.
 *
 * Rules:
 *
 *  - **Visible region.** Each branch first computes its *visible*
 *    region — the layers the user can actually see:
 *      - **Idle (no transition).** The topmost non-overlay entry as
 *        the base, plus every overlay entry above it.
 *      - **Card transition.** The underneath entry (parallax) + the
 *        top entry (slide), both animated.
 *      - **Overlay transition.** The static base..underneath run plus
 *        the animated overlay top.
 *
 *  - **Retention (card-stack screen retention).** Every entry *below*
 *    the visible region's base is kept mounted as a `hidden: true`
 *    static layer (`display: none`), instead of unmounting. So a card
 *    push leaves the covered card mounted, and a pop reveals the
 *    already-mounted underneath — no rebuild, no lost scroll/UI state
 *    (matching native stacks). Overlays already preserved their
 *    underneath; this extends the same retain-below-base behaviour to
 *    cards, and to entries deeper than the immediate underneath during
 *    a deep-stack transition.
 *
 *  - **Bounds.** `maxRetained` (the `<Stack maxRetainedScreens>` prop)
 *    caps how many covered cards stay mounted; `MAX_LAYERS` is the hard
 *    renderer-slot cap. Both trim the *deepest* (front) layers, so the
 *    visible region at the end of the list is never truncated.
 *
 * The Layer.key for the Stack render is `layer-${entry.key}` — stable
 * across animation phases. `<Layer>` rebinds its transform reactively
 * (via the reactive form of `useAnimatedStyle`) as `animation` flips
 * between a spec and `null`, so the layer never remounts just to change
 * its animation state and screen subtrees survive the transition. The
 * reactive binding dedupes its own register/unregister by signature
 * internally (see `useAnimatedStyle`), so no per-layer variant key is
 * computed here.
 */
import type { SharedValue } from '@sigx/lynx';
import { SHEET_BACKDROP_MAX_OPACITY } from '@sigx/lynx-sheet';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen-width.js';

// Re-exported so `<Stack>`/tests keep one import site for the sheet dim
// constants alongside the mappers below (the value now lives in the shared
// sheet package).
export { SHEET_BACKDROP_MAX_OPACITY };
import type {
    Presentation,
    StackEntry,
    TransitionKind,
    TransitionState,
} from '../types.js';

const PARALLAX_FACTOR = 0.3;

/**
 * Hard cap on how many layers `<Stack>` renders at once. The Stack body
 * emits exactly this many position-stable slots (unrolled), so
 * `computeLayers` must never return more — excess deepest (hidden,
 * retained) layers are trimmed off the front. The slots are mechanical
 * (just verbose), so this can be raised if an app legitimately stacks
 * more; 24 is high enough that normal card apps never hit the trim
 * boundary, while still bounding retained-screen memory.
 */
export const MAX_LAYERS = 24;

export type LayerAnimation = {
    mapperName: 'translateX' | 'translateY' | 'opacity';
    inputRange: readonly [number, number];
    outputRange: readonly [number, number];
    progress: SharedValue<number>;
};

export interface Layer {
    /** The entry whose component renders inside this layer. */
    readonly entry: StackEntry;
    /** When non-null, the layer's host view binds a `useAnimatedStyle` mapper. */
    readonly animation: LayerAnimation | null;
    /**
     * Retained-but-covered layer: mounted (so its screen subtree, signals,
     * and scroll offset survive), rendered with `display: none` so it costs
     * no paint/layout while a higher opaque card covers it. Always paired
     * with `animation: null` — a hidden layer never animates. Falsy/omitted
     * = visible.
     */
    readonly hidden?: boolean;
    /**
     * Static `translateY` (px) applied as a plain style on the host view.
     * Used for a resting sheet that cannot hold an animation binding —
     * either something was pushed above it (only the top sheet binds the
     * dedicated sheet SharedValue) or animations are disabled. Keeps the
     * sheet at its partial-height position without a binding.
     */
    readonly staticOffsetY?: number;
}

/**
 * Sheet-specific inputs to `computeLayers`, resolved by `<Stack>` from the
 * top sheet entry's `ScreenOptions`. Passed as a parameter so this module
 * stays pure (unit-testable without the screen registry).
 */
export interface SheetLayerContext {
    /**
     * Dedicated sheet SharedValue (reveal px: 0 = off-screen, N = visible
     * px) — separate from the shared transition `progress`, which is reset
     * to 0 at the start of every transition (see `core.ts`) and therefore
     * can't hold a resting sheet's position. `null` when animations are
     * disabled.
     */
    sheetReveal: SharedValue<number> | null;
    /** Largest detent (px) of the top sheet — fixes the translateY range. */
    maxDetentPx: number;
    /** Resting translateY (px) for a sheet that can't bind (non-top / no SV). */
    staticOffsetY: (entry: StackEntry) => number;
}

export function isOverlayPresentation(p: Presentation): boolean {
    return (
        p === 'modal' ||
        p === 'fullScreen' ||
        p === 'transparent-modal' ||
        p === 'sheet'
    );
}

/**
 * Card-presentation transition transforms. `role='top'` is the entry
 * being pushed/popped; `role='underneath'` is the one parallaxing.
 */
function cardAnimation(
    role: 'top' | 'underneath',
    kind: TransitionKind,
    progress: SharedValue<number>,
): LayerAnimation {
    if (kind === 'push') {
        if (role === 'top') {
            return { mapperName: 'translateX', inputRange: [0, 1], outputRange: [SCREEN_WIDTH, 0], progress };
        }
        return { mapperName: 'translateX', inputRange: [0, 1], outputRange: [0, -PARALLAX_FACTOR * SCREEN_WIDTH], progress };
    }
    // pop
    if (role === 'top') {
        return { mapperName: 'translateX', inputRange: [0, 1], outputRange: [0, SCREEN_WIDTH], progress };
    }
    return { mapperName: 'translateX', inputRange: [0, 1], outputRange: [-PARALLAX_FACTOR * SCREEN_WIDTH, 0], progress };
}

/**
 * Overlay-presentation transition transform for the animated top.
 * The underneath of an overlay transition does not animate (modal
 * doesn't reposition its background); we render it as a static layer
 * instead, so this function only produces the top's transform.
 */
function overlayTopAnimation(
    kind: TransitionKind,
    progress: SharedValue<number>,
): LayerAnimation {
    if (kind === 'push') {
        return { mapperName: 'translateY', inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0], progress };
    }
    return { mapperName: 'translateY', inputRange: [0, 1], outputRange: [0, SCREEN_HEIGHT], progress };
}

/**
 * Sheet transform — one fixed mapper for every phase (push, pop, rest,
 * drag). `sheetReveal` has reveal-px semantics: 0 = off-screen
 * (`translateY = SCREEN_HEIGHT`), `maxDetentPx` = fully open at the
 * largest detent (`translateY = SCREEN_HEIGHT - maxDetentPx`). Because
 * the SV value alone encodes position, `withTiming` between any two
 * reveal values (push-in, snap, dismiss) animates correctly without
 * per-kind input/output ranges — unlike card/overlay transitions, the
 * kind is irrelevant here.
 */
export function sheetAnimation(
    sheetReveal: SharedValue<number>,
    maxDetentPx: number,
): LayerAnimation {
    return {
        mapperName: 'translateY',
        inputRange: [0, maxDetentPx],
        outputRange: [SCREEN_HEIGHT, SCREEN_HEIGHT - maxDetentPx],
        progress: sheetReveal,
    };
}

/**
 * Backdrop opacity behind a sheet — tracks the same sheet SV over the
 * same `[0, maxDetentPx]` reveal range, so a partially-open detent dims
 * proportionally and a drag-to-dismiss fades the dim out in lockstep with
 * the sheet sliding down. (The runtime binding lives in
 * `@sigx/lynx-sheet`'s `<Backdrop>`, which `<SheetBackdrop>` feeds the
 * identical range; this stays the plan-level statement of that contract.)
 */
export function backdropAnimation(
    sheetReveal: SharedValue<number>,
    maxDetentPx: number,
): LayerAnimation {
    return {
        mapperName: 'opacity',
        inputRange: [0, maxDetentPx],
        outputRange: [0, SHEET_BACKDROP_MAX_OPACITY],
        progress: sheetReveal,
    };
}

/**
 * Layer for a resting (non-transitioning) visible entry. Non-sheets are
 * plain static layers. The TOP sheet keeps a live `sheetAnimation` binding
 * even at rest — safe because the binding is on the dedicated sheet SV,
 * not the shared transition `progress` (which resets on every transition)
 * — so the drag worklet can move the sheet between detents without a
 * rebind. A covered sheet (or one with animations disabled) instead gets
 * a static translateY.
 */
function restingLayer(
    entry: StackEntry,
    isTop: boolean,
    sheetCtx: SheetLayerContext | undefined,
): Layer {
    if (entry.presentation !== 'sheet' || !sheetCtx) {
        return { entry, animation: null, hidden: false };
    }
    if (isTop && sheetCtx.sheetReveal) {
        return {
            entry,
            animation: sheetAnimation(sheetCtx.sheetReveal, sheetCtx.maxDetentPx),
            hidden: false,
        };
    }
    return {
        entry,
        animation: null,
        hidden: false,
        staticOffsetY: sheetCtx.staticOffsetY(entry),
    };
}

/** Walk back from `from` past overlay entries to the topmost non-overlay. */
function nonOverlayBaseIdx(stack: readonly StackEntry[], from: number): number {
    let baseIdx = from;
    while (baseIdx > 0 && isOverlayPresentation(stack[baseIdx].presentation)) {
        baseIdx -= 1;
    }
    return baseIdx;
}

/**
 * Compute the visible-layer list for one render of `<Stack>`. Pure —
 * unit-testable independently of the renderer.
 *
 * Each branch produces `{ visBaseIdx, visible }`: `visible` is the
 * animated/painted region, and `visBaseIdx` is the stack index of that
 * region's lowest layer. Everything in `stack` below `visBaseIdx` is
 * then retained as hidden static layers (see the module docstring).
 *
 * `maxRetained` caps the retained (hidden) layers; `undefined` means
 * "retain all, bounded only by `MAX_LAYERS`".
 */
export function computeLayers(
    stack: readonly StackEntry[],
    transition: TransitionState | null,
    progress: SharedValue<number> | null,
    maxRetained?: number,
    sheetCtx?: SheetLayerContext,
): Layer[] {
    let visBaseIdx: number;
    let visible: Layer[];

    if (!transition) {
        // Idle: topmost non-overlay base + any overlays above it.
        visBaseIdx = nonOverlayBaseIdx(stack, stack.length - 1);
        visible = stack
            .slice(visBaseIdx)
            .map((entry, i) =>
                restingLayer(entry, visBaseIdx + i === stack.length - 1, sheetCtx),
            );
    } else if (!isOverlayPresentation(transition.topEntry.presentation)) {
        // Card transition: the two participating entries, both animated
        // (parallax underneath + slide top). `progress` may be null when
        // animations are disabled — produce static layers in that case.
        // A sheet underneath a card push keeps its partial-height position
        // statically instead of the horizontal parallax.
        const underneathIdx = stack.findIndex(
            (e) => e.key === transition.underneathEntry.key,
        );
        // Underneath is the visible base. If it isn't on the stack (e.g.
        // mid-pop where the mutation already ran), retain nothing rather
        // than slicing with a negative index.
        visBaseIdx = underneathIdx >= 0 ? underneathIdx : 0;
        const underneathIsSheet =
            transition.underneathEntry.presentation === 'sheet';
        visible = [
            underneathIsSheet
                ? restingLayer(transition.underneathEntry, false, sheetCtx)
                : {
                    entry: transition.underneathEntry,
                    animation: progress ? cardAnimation('underneath', transition.kind, progress) : null,
                    hidden: false,
                },
            {
                entry: transition.topEntry,
                animation: progress ? cardAnimation('top', transition.kind, progress) : null,
                hidden: false,
            },
        ];
    } else {
        // Overlay transition: the full layer stack up through the
        // underneath entry stays static (no transform) plus the animated
        // top. (Sheets among the static run keep their resting offset.)
        const underneathIdx = stack.findIndex(
            (e) => e.key === transition.underneathEntry.key,
        );
        // If the underneath isn't in the stack (e.g. mid-pop where the
        // stack mutation already removed an entry), fall back to the
        // current top of the stack.
        const lastStaticIdx = underneathIdx >= 0 ? underneathIdx : stack.length - 1;
        visBaseIdx = nonOverlayBaseIdx(stack, lastStaticIdx);
        const staticLayers: Layer[] = stack
            .slice(visBaseIdx, lastStaticIdx + 1)
            .map((entry) => restingLayer(entry, false, sheetCtx));
        const topIsSheet = transition.topEntry.presentation === 'sheet';
        visible = [
            ...staticLayers,
            {
                entry: transition.topEntry,
                animation: topIsSheet
                    ? (sheetCtx?.sheetReveal
                        ? sheetAnimation(sheetCtx.sheetReveal, sheetCtx.maxDetentPx)
                        : null)
                    : (progress ? overlayTopAnimation(transition.kind, progress) : null),
                hidden: false,
            },
        ];
    }

    // Retention: every entry below the visible base stays mounted as a
    // hidden static layer. Ordered deepest-first so each surviving entry
    // keeps a stable slot index across pushes/pops (the Stack renderer's
    // fixed slots remount keyed children whose slot index shifts).
    const retained: Layer[] = stack
        .slice(0, visBaseIdx)
        .map((entry) => ({ entry, animation: null, hidden: true }));

    let result = [...retained, ...visible];

    // Apply the user's retention window, then the hard renderer cap.
    // Both trim the deepest (front) layers, so the visible region at the
    // tail is never truncated.
    if (maxRetained != null && retained.length > maxRetained) {
        result = result.slice(retained.length - maxRetained);
    }
    if (result.length > MAX_LAYERS) {
        result = result.slice(result.length - MAX_LAYERS);
    }

    return result;
}
