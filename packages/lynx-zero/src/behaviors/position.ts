/**
 * Anchored positioning on lynx — zero's `PositionStrategy` SHAPE over the
 * platform's real measurement primitives.
 *
 * Geometry comes from `useViewportRect` (`boundingClientRect`) — NOT from
 * `bindlayoutchange`'s payload. The event's coordinates are not
 * page-relative on Android (#1080: correct size, `top/left` of 0 — the
 * select's list clamped to the screen corner), and even where they are
 * (iOS) they are layout-time numbers, blind to scroll and transforms. So
 * layout events serve only as "something moved, re-measure" triggers, and
 * the floating panel's own measure re-measures the anchor too — a popup
 * opening after a scroll positions against where the anchor IS, not where
 * layout first put it.
 *
 * The math is a pure function (`computeAnchorPosition`) so it tests over
 * fake rects; the wiring half (`createAnchorPosition`) owns the two
 * measured rects and recomputes whenever either lands. Mid-scroll tracking
 * of an OPEN popup is still out of scope: nothing re-fires while scrolling
 * (overlays that open from a scrolling anchor should close on scroll).
 *
 * Placement values are the zero contract's `PLACEMENT_VOCABULARY` subset the
 * popup's anatomy declares — the runtime stamps the RESOLVED side (after
 * flipping) through `partBag`, exactly like the web behavior does.
 */
import { useScreen, useViewportRect } from '@sigx/lynx';
import type { ElementLayout, LayoutChangeEvent, MainThread, MainThreadRef } from '@sigx/lynx';

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
    /** Bind on the ANCHOR element: `main-thread:ref={anchorRef}`. */
    anchorRef: MainThreadRef<MainThread.Element | null>;
    /** Bind on the FLOATING element: `main-thread:ref={floatingRef}`. */
    floatingRef: MainThreadRef<MainThread.Element | null>;
    /**
     * Wire on the ANCHOR element: `bindlayoutchange={anchorLayoutChange}`.
     * The event payload is IGNORED — it only triggers a measurement (#1080).
     */
    anchorLayoutChange: (event: LayoutChangeEvent) => void;
    /** Wire on the FLOATING element (inside the overlay outlet). */
    floatingLayoutChange: (event: LayoutChangeEvent) => void;
    /** The resolved position, or null until both nodes have measured. */
    position(): ResolvedPosition | null;
    /** The absolute inline style for the floating element. */
    style(): Record<string, string | number>;
}

/**
 * The wiring half. Call in component setup; wire BOTH bindings on each
 * element (`main-thread:ref` carries the element to measure,
 * `bindlayoutchange` says when). Position reads are reactive — `style()`
 * recomputes in whatever render or effect reads it once a measurement or
 * the viewport changes.
 */
export function createAnchorPosition(options: AnchorPositionOptions = {}): LynxAnchorPosition {
    const anchor = useViewportRect();
    const floating = useViewportRect();
    // The screen metrics stand in for the viewport: viewport rects and
    // screen metrics share an origin for a full-screen lynx app, they're
    // reactive to rotation, and they need no extra measurement round-trip.
    // Keyboard insets are out of scope here (an anchored popup over a
    // raised keyboard is its own problem).
    const screen = useScreen();

    const position = (): ResolvedPosition | null => {
        const a = anchor.rect.value;
        const f = floating.rect.value;
        const v = screen.value;
        return a && f && v.width > 0
            ? computeAnchorPosition(a, { width: f.width, height: f.height }, v, options)
            : null;
    };

    return {
        anchorRef: anchor.ref,
        floatingRef: floating.ref,
        anchorLayoutChange: () => {
            anchor.measure();
        },
        floatingLayoutChange: () => {
            // The floating panel measuring means the popup is opening (or its
            // content changed): re-measure the anchor too, so the position is
            // computed against where the anchor IS — a layout-time anchor
            // rect goes stale the moment the page scrolls.
            anchor.measure();
            floating.measure();
        },
        position,
        style: () => {
            const p = position();
            // Off-glass until measured: painting at 0,0 for one frame reads
            // as a flash in the corner; off-glass reads as "not open yet".
            if (!p) return { position: 'absolute', top: '-10000px', left: '-10000px' };
            return { position: 'absolute', top: `${p.top}px`, left: `${p.left}px` };
        },
    };
}
