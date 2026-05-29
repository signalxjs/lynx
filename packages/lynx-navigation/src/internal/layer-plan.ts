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
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen-width.js';
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
    axis: 'translateX' | 'translateY';
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
}

export function isOverlayPresentation(p: Presentation): boolean {
    return p === 'modal' || p === 'fullScreen' || p === 'transparent-modal';
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
            return { axis: 'translateX', inputRange: [0, 1], outputRange: [SCREEN_WIDTH, 0], progress };
        }
        return { axis: 'translateX', inputRange: [0, 1], outputRange: [0, -PARALLAX_FACTOR * SCREEN_WIDTH], progress };
    }
    // pop
    if (role === 'top') {
        return { axis: 'translateX', inputRange: [0, 1], outputRange: [0, SCREEN_WIDTH], progress };
    }
    return { axis: 'translateX', inputRange: [0, 1], outputRange: [-PARALLAX_FACTOR * SCREEN_WIDTH, 0], progress };
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
        return { axis: 'translateY', inputRange: [0, 1], outputRange: [SCREEN_HEIGHT, 0], progress };
    }
    return { axis: 'translateY', inputRange: [0, 1], outputRange: [0, SCREEN_HEIGHT], progress };
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
): Layer[] {
    let visBaseIdx: number;
    let visible: Layer[];

    if (!transition) {
        // Idle: topmost non-overlay base + any overlays above it.
        visBaseIdx = nonOverlayBaseIdx(stack, stack.length - 1);
        visible = stack
            .slice(visBaseIdx)
            .map((entry) => ({ entry, animation: null, hidden: false }));
    } else if (!isOverlayPresentation(transition.topEntry.presentation)) {
        // Card transition: the two participating entries, both animated
        // (parallax underneath + slide top). `progress` may be null when
        // animations are disabled — produce static layers in that case.
        const underneathIdx = stack.findIndex(
            (e) => e.key === transition.underneathEntry.key,
        );
        // Underneath is the visible base. If it isn't on the stack (e.g.
        // mid-pop where the mutation already ran), retain nothing rather
        // than slicing with a negative index.
        visBaseIdx = underneathIdx >= 0 ? underneathIdx : 0;
        visible = [
            {
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
        // top.
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
            .map((entry) => ({ entry, animation: null, hidden: false }));
        visible = [
            ...staticLayers,
            {
                entry: transition.topEntry,
                animation: progress ? overlayTopAnimation(transition.kind, progress) : null,
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
