/**
 * The tabs indicator's geometry — zero's `Tabs.Indicator` contract (zero#324)
 * spelled with this platform's measurement primitives.
 *
 * The web part publishes the active tab's box as four custom properties and
 * lets the recipe position the span. Lynx cannot do that: the lynx target
 * refuses every web-runtime property (`--tabs-indicator-*` among them), and a
 * custom property written inline is not reliably registered by the engine.
 * So on lynx the part positions ITSELF: an absolute box over the active tab,
 * in the list's coordinates, and the recipe only paints it (a bottom border
 * for daisy's underline, a fill for a pill, …).
 *
 * Two measurements feed it, each used for what it is right about:
 *
 * - the tab's and the list's viewport rects (`boundingClientRect`, through
 *   `useViewportRect`) give the POSITION. Both are measured in the same pass,
 *   so a scroll or a screen transition moves both and the difference holds.
 * - the tab's layout event gives the SIZE. A viewport rect includes the tab's
 *   transform — a press effect that scales the tab would shrink the
 *   indicator with it — while the layout frame is transform-blind. A scale
 *   about the centre leaves the centre where it was, so the box is rebuilt
 *   around the rect's centre at the layout size (zero's web part undoes the
 *   transform matrix for the same reason).
 *
 * Offsets are from the list's border box. A list with a border would offset
 * the indicator by that border's width; no shipped skin borders the list.
 */

/** A rect in viewport coordinates (the fields this needs of `ViewportRect`). */
export interface IndicatorRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** A layout frame's size — transform-blind. */
export interface IndicatorSize {
    width: number;
    height: number;
}

/** The indicator's box in the list's coordinates (px). */
export interface IndicatorBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * The active tab's box relative to its list, or `null` while either rect is
 * unknown (the part then renders `display: none`, as zero's web part does
 * before its first measurement).
 */
export function computeIndicatorBox(
    list: IndicatorRect | null,
    tab: IndicatorRect | null,
    size: IndicatorSize | null,
): IndicatorBox | null {
    if (!list || !tab) return null;
    const width = size && size.width > 0 ? size.width : tab.width;
    const height = size && size.height > 0 ? size.height : tab.height;
    const values = [list.left, list.top, tab.left, tab.top, tab.width, tab.height, width, height];
    if (!values.every(Number.isFinite) || width <= 0 || height <= 0) return null;
    const centerX = tab.left + tab.width / 2;
    const centerY = tab.top + tab.height / 2;
    return {
        left: round(centerX - width / 2 - list.left),
        top: round(centerY - height / 2 - list.top),
        width: round(width),
        height: round(height),
    };
}

/** The inline style the part renders with: hidden until measured, then absolute. */
export function indicatorStyle(box: IndicatorBox | null): Record<string, string> {
    if (!box) return { display: 'none' };
    return {
        position: 'absolute',
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
    };
}
