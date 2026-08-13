/**
 * Anchored positioning on lynx — zero's `PositionStrategy` SHAPE over the
 * platform's real measurement primitives. No `getBoundingClientRect`, no
 * scroll/resize listeners: `bindlayoutchange` hands PAGE-RELATIVE rects
 * (`useElementLayout`), the popup mounts in the page-root overlay outlet
 * (also page coordinates), so the placement math composes directly and the
 * result is an absolute `top`/`left` inline style.
 *
 * The math is a pure function (`computeAnchorPosition`) so it tests over
 * fake rects; the wiring half (`createAnchorPosition`) owns the two layout
 * signals and recomputes whenever EITHER node reports a new layout — which
 * covers content growth and rotation. An anchor inside a `scroll-view` is a
 * documented v1 limitation: scrolling does not fire `layoutchange` on the
 * anchor, so an open anchored popup does not track mid-scroll (the web's
 * scroll-listener repositioning has no lynx counterpart yet; overlays that
 * open from a scrolling anchor should close on scroll).
 *
 * Placement values are the zero contract's `PLACEMENT_VOCABULARY` subset the
 * popup's anatomy declares — the runtime stamps the RESOLVED side (after
 * flipping) through `partBag`, exactly like the web behavior does.
 */
import { signal, useScreen } from '@sigx/lynx';
import type { ElementLayout, LayoutChangeEvent } from '@sigx/lynx';
import { useElementLayout } from '@sigx/lynx';

export type LynxPlacement =
    | 'top' | 'top-start' | 'top-end'
    | 'bottom' | 'bottom-start' | 'bottom-end'
    | 'left' | 'left-start' | 'left-end'
    | 'right' | 'right-start' | 'right-end';

export interface AnchorPositionOptions {
    placement?: LynxPlacement;
    /** Gap between anchor and popup, px. */
    offset?: number;
    /** Minimum distance from the viewport edge before flipping, px. */
    viewportPadding?: number;
}

export interface ResolvedPosition {
    top: number;
    left: number;
    /** The side that actually rendered, after flipping. */
    placement: LynxPlacement;
}

interface Size {
    width: number;
    height: number;
}

const side = (placement: LynxPlacement): 'top' | 'bottom' | 'left' | 'right' =>
    placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right';

const alignment = (placement: LynxPlacement): 'start' | 'end' | undefined =>
    placement.split('-')[1] as 'start' | 'end' | undefined;

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;

function mainAxisStart(anchor: ElementLayout, floating: Size, s: 'top' | 'bottom' | 'left' | 'right', offset: number): number {
    switch (s) {
        case 'top': return anchor.top - floating.height - offset;
        case 'bottom': return anchor.bottom + offset;
        case 'left': return anchor.left - floating.width - offset;
        case 'right': return anchor.right + offset;
    }
}

function crossAxisStart(anchor: ElementLayout, floating: Size, placement: LynxPlacement): number {
    const s = side(placement);
    const align = alignment(placement);
    const vertical = s === 'top' || s === 'bottom';
    const anchorStart = vertical ? anchor.left : anchor.top;
    const anchorSize = vertical ? anchor.width : anchor.height;
    const floatingSize = vertical ? floating.width : floating.height;
    if (align === 'start') return anchorStart;
    if (align === 'end') return anchorStart + anchorSize - floatingSize;
    return anchorStart + anchorSize / 2 - floatingSize / 2;
}

/**
 * The placement math, pure. Flips to the opposite side when the preferred
 * one overflows the viewport and the opposite fits better; clamps the cross
 * axis into the viewport either way.
 */
export function computeAnchorPosition(
    anchor: ElementLayout,
    floating: Size,
    viewport: { width: number; height: number },
    options: AnchorPositionOptions = {},
): ResolvedPosition {
    const preferred = options.placement ?? 'bottom';
    const offset = options.offset ?? 4;
    const padding = options.viewportPadding ?? 8;

    let s = side(preferred);
    const vertical = s === 'top' || s === 'bottom';
    const limit = vertical ? viewport.height : viewport.width;
    const size = vertical ? floating.height : floating.width;

    const fits = (candidate: typeof s): boolean => {
        const start = mainAxisStart(anchor, floating, candidate, offset);
        return start >= padding && start + size <= limit - padding;
    };
    if (!fits(s) && fits(OPPOSITE[s])) s = OPPOSITE[s];
    const placement = (alignment(preferred) ? `${s}-${alignment(preferred)}` : s) as LynxPlacement;

    const main = mainAxisStart(anchor, floating, s, offset);
    const crossLimit = vertical ? viewport.width : viewport.height;
    const crossSize = vertical ? floating.width : floating.height;
    const cross = Math.min(
        Math.max(crossAxisStart(anchor, floating, placement), padding),
        Math.max(crossLimit - crossSize - padding, padding),
    );

    return vertical
        ? { top: main, left: cross, placement }
        : { top: cross, left: main, placement };
}

export interface LynxAnchorPosition {
    /** Wire on the ANCHOR element: `bindlayoutchange={anchorLayoutChange}`. */
    anchorLayoutChange: (event: LayoutChangeEvent) => void;
    /** Wire on the FLOATING element (inside the overlay outlet). */
    floatingLayoutChange: (event: LayoutChangeEvent) => void;
    /** The resolved position, or null until both nodes have measured. */
    position(): ResolvedPosition | null;
    /** The absolute inline style for the floating element. */
    style(): Record<string, string | number>;
}

/**
 * The wiring half. Call in component setup; recomputes whenever either
 * layout signal or the viewport changes.
 */
export function createAnchorPosition(options: AnchorPositionOptions = {}): LynxAnchorPosition {
    const anchor = useElementLayout();
    const floating = useElementLayout();
    // The screen metrics stand in for the viewport: page = screen for a
    // full-screen lynx app, they're reactive to rotation, and they need no
    // main-thread measurement round-trip. Keyboard insets are out of scope
    // here (an anchored popup over a raised keyboard is its own problem).
    const screen = useScreen();
    const resolved = signal<{ current: ResolvedPosition | null }>({ current: null });

    const recompute = (): ResolvedPosition | null => {
        const a = anchor.layout.value;
        const f = floating.layout.value;
        const v = screen.value;
        const next = a && f && v.width > 0
            ? computeAnchorPosition(a, { width: f.width, height: f.height }, v, options)
            : null;
        resolved.current = next;
        return next;
    };

    return {
        anchorLayoutChange: (event) => {
            anchor.onLayoutChange(event);
            recompute();
        },
        floatingLayoutChange: (event) => {
            floating.onLayoutChange(event);
            recompute();
        },
        position: () => resolved.current,
        style: () => {
            const p = resolved.current;
            // Off-glass until measured: painting at 0,0 for one frame reads
            // as a flash in the corner; off-glass reads as "not open yet".
            if (!p) return { position: 'absolute', top: '-10000px', left: '-10000px' };
            return { position: 'absolute', top: `${p.top}px`, left: `${p.left}px` };
        },
    };
}
