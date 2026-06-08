/**
 * Pure placement math for the Select dropdown — kept separate from the
 * component so it's unit-testable without a renderer (same shape as
 * lynx-markdown's `trigger/position.ts`).
 *
 * The menu is rendered in a `position: fixed` overlay (escaping the scroll
 * view, so it's never clipped) and anchored to the trigger's on-screen frame.
 * It opens **below** the trigger by default and **flips above** when there
 * isn't enough room below — and clamps its height so it never runs off the
 * top/bottom edge (the list scrolls internally when the clamp bites).
 */

export interface TriggerFrame {
    /** Trigger top edge, relative to the viewport, in CSS pixels. */
    top: number;
    /** Trigger left edge, relative to the viewport, in CSS pixels. */
    left: number;
    width: number;
    height: number;
}

export interface DropdownPlacement {
    /** True when the menu flips above the trigger. */
    openUp: boolean;
    left: number;
    width: number;
    /** Fixed offset from the viewport top (set when opening down). */
    top?: number;
    /** Fixed offset from the viewport bottom (set when opening up). */
    bottom?: number;
    /** Height clamp for the (internally scrollable) option list. */
    maxHeight: number;
}

const GAP = 4;
/** Rough height of one option row (12px padding × 2 + ~20px text). */
const ROW_HEIGHT = 44;
/** Don't let the menu grow taller than this even with room to spare. */
const MAX_DROPDOWN_HEIGHT = 280;

export function placeSelectDropdown(opts: {
    trigger: TriggerFrame;
    screenHeight: number;
    optionCount: number;
    rowHeight?: number;
    maxHeight?: number;
}): DropdownPlacement {
    const rowH = opts.rowHeight ?? ROW_HEIGHT;
    const cap = opts.maxHeight ?? MAX_DROPDOWN_HEIGHT;
    const desired = Math.min(opts.optionCount * rowH, cap);
    const t = opts.trigger;

    const spaceBelow = opts.screenHeight - (t.top + t.height) - GAP;
    const spaceAbove = t.top - GAP;

    // Prefer below; flip up when the full menu doesn't fit below but there's
    // more room above (the list scrolls internally if even that clamps).
    const fitsBelow = spaceBelow >= desired;
    const openUp = !fitsBelow && spaceAbove > spaceBelow;

    const maxHeight = Math.max(0, Math.min(desired, openUp ? spaceAbove : spaceBelow));
    const base = { openUp, left: t.left, width: t.width, maxHeight };

    return openUp
        ? { ...base, bottom: opts.screenHeight - t.top + GAP }
        : { ...base, top: t.top + t.height + GAP };
}
