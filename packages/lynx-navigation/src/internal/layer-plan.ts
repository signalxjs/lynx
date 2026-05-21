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
 *  - **Idle (no transition).** Render the topmost non-overlay entry
 *    as the base, plus every overlay entry above it. Overlays
 *    (`modal` / `fullScreen` / `transparent-modal`) keep their
 *    underneath mounted; cards replace their underneath in the base
 *    layer.
 *
 *  - **Card transition.** Two layers: the underneath entry (animated
 *    with the parallax-card-underneath spec) and the top entry
 *    (animated with the slide-in-from-right spec). After the
 *    transition completes, the idle rule kicks in — the underneath
 *    unmounts because the new top becomes the sole base.
 *
 *  - **Overlay transition.** The full idle layer stack up through the
 *    underneath entry stays static (no transform). The animated top
 *    is the only layer with a transform. After the transition, the
 *    overlay either joins the static idle stack (push) or unmounts
 *    (pop).
 *
 * The Layer.key for the Stack render is
 * `layer-${entry.key}-${animVariant(layer.animation)}`. The variant
 * suffix forces a remount when an entry transitions from animated to
 * static (or vice versa) — `useAnimatedStyle` can't re-bind mid-life,
 * so we get a fresh `useAnimatedStyle` call per animation state.
 * Modal underneath layers never animate, so they stay statically
 * keyed across the modal lifecycle and their state (per-tab Stack,
 * scroll, in-flight inputs) survives.
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
}

export function isOverlayPresentation(p: Presentation): boolean {
    return p === 'modal' || p === 'fullScreen' || p === 'transparent-modal';
}

/**
 * Suffix used in a layer's render key. Stable for the layer's
 * lifetime (same entry, same animation kind) and changes when the
 * animation transitions on/off so the Layer remounts and rebinds.
 */
export function animationVariant(animation: LayerAnimation | null): string {
    if (!animation) return 'static';
    // Output range alone identifies the transition shape — different
    // animations (card-top vs card-underneath vs overlay-top, push vs
    // pop) all land on different range tuples.
    return `${animation.axis}:${animation.outputRange[0]}->${animation.outputRange[1]}`;
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

/**
 * Compute the visible-layer list for one render of `<Stack>`. Pure —
 * unit-testable independently of the renderer.
 */
export function computeLayers(
    stack: readonly StackEntry[],
    transition: TransitionState | null,
    progress: SharedValue<number> | null,
): Layer[] {
    if (!transition) {
        // Idle: topmost non-overlay base + any overlays above it.
        let baseIdx = stack.length - 1;
        while (baseIdx > 0 && isOverlayPresentation(stack[baseIdx].presentation)) {
            baseIdx -= 1;
        }
        return stack.slice(baseIdx).map((entry) => ({ entry, animation: null }));
    }

    // A transition is in flight. `progress` may still be null when
    // animations are disabled — produce static layers in that case
    // (the animation never plays; the transition timer just ticks).
    const isOverlay = isOverlayPresentation(transition.topEntry.presentation);
    if (!isOverlay) {
        // Card transition: just the two participating entries, both
        // animated (parallax underneath + slide top).
        return [
            {
                entry: transition.underneathEntry,
                animation: progress ? cardAnimation('underneath', transition.kind, progress) : null,
            },
            {
                entry: transition.topEntry,
                animation: progress ? cardAnimation('top', transition.kind, progress) : null,
            },
        ];
    }

    // Overlay transition: render the full idle layer stack up through
    // the underneath entry (all static — they don't animate) plus the
    // animated top.
    const underneathIdx = stack.findIndex(
        (e) => e.key === transition.underneathEntry.key,
    );
    // If the underneath isn't in the stack (e.g. mid-pop where the
    // stack mutation already removed an entry), fall back to the
    // current top of the stack.
    const lastStaticIdx = underneathIdx >= 0 ? underneathIdx : stack.length - 1;

    let baseIdx = lastStaticIdx;
    while (baseIdx > 0 && isOverlayPresentation(stack[baseIdx].presentation)) {
        baseIdx -= 1;
    }

    const staticLayers: Layer[] = stack
        .slice(baseIdx, lastStaticIdx + 1)
        .map((entry) => ({ entry, animation: null }));

    return [
        ...staticLayers,
        {
            entry: transition.topEntry,
            animation: progress ? overlayTopAnimation(transition.kind, progress) : null,
        },
    ];
}
