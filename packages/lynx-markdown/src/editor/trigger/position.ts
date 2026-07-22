/**
 * Pure placement math for the suggestion popup.
 *
 * Inputs are deliberately primitive so this is unit-testable without a
 * renderer: the element-local caret rect (from `bindselection`), the
 * positioning container's **viewport** frame (`useViewportRect`), the screen
 * height and the keyboard height (`@sigx/lynx-keyboard`).
 *
 * The container frame must be viewport-relative and transform-aware — a
 * layout-page frame (`bindlayoutchange`) does not move with a main-thread
 * transform, so inside a sheet riding the keyboard lift the math would place
 * against the composer's *unlifted* position and flip the popup down behind
 * the keyboard (#755).
 *
 * Placement: **above the caret by default** — the editor usually sits in a
 * bottom-docked composer, so above is where the room is — flipping below
 * when there isn't enough space above. Either way the popup is clamped so it
 * never extends under the keyboard, and the list scrolls internally when the
 * clamp bites. A host that knows better can pin the side outright
 * (`prefer: 'above' | 'below'`).
 */

import { Platform } from '@sigx/lynx';

export interface CaretRect {
    x: number;
    y: number;
    height: number;
}

/** Absolute-position style for the popup within its relative container. */
export interface PopupPlacement {
    placement: 'above' | 'below';
    left: number;
    /** Set for `below`: container-local top edge. */
    top?: number;
    /** Set for `above`: container-local bottom anchor (no height knowledge needed). */
    bottom?: number;
    /** Clamp for the scrollable list. */
    maxHeight: number;
}

const GAP = 4;
/** Roughly one suggestion row — below this, flip rather than squeeze. */
const MIN_USEFUL_HEIGHT = 44;

export function placeSuggestionPopup(opts: {
    caretRect: CaretRect;
    /** Viewport-relative top of the positioning container (0 until measured). */
    containerTop: number;
    containerWidth: number;
    containerHeight: number;
    screenHeight: number;
    keyboardHeight: number;
    popupWidth: number;
    maxPopupHeight: number;
    /**
     * Pin the side instead of measuring room for it. `'auto'` (default) picks
     * from the available space; an explicit side still gets the keyboard
     * clamp, so the list scrolls rather than overflowing.
     */
    prefer?: 'auto' | 'above' | 'below';
}): PopupPlacement {
    const caretTopAbs = opts.containerTop + opts.caretRect.y;
    const caretBottomAbs = caretTopAbs + opts.caretRect.height;
    const keyboardTop = opts.screenHeight - opts.keyboardHeight;

    const spaceAbove = caretTopAbs - GAP;
    const spaceBelow = keyboardTop - caretBottomAbs - GAP;

    const fitsAbove = spaceAbove >= Math.min(opts.maxPopupHeight, MIN_USEFUL_HEIGHT);
    const prefer = opts.prefer ?? 'auto';
    const placement: PopupPlacement['placement'] = prefer !== 'auto'
        ? prefer
        : fitsAbove || spaceAbove >= spaceBelow ? 'above' : 'below';

    const left = Math.max(0, Math.min(opts.caretRect.x, opts.containerWidth - opts.popupWidth));

    // Never exceed the actual available space — the clamp guarantee wins over
    // a comfortable minimum height (the list scrolls inside whatever fits).
    if (placement === 'above') {
        return {
            placement,
            left,
            bottom: opts.containerHeight - opts.caretRect.y + GAP,
            maxHeight: Math.max(0, Math.min(opts.maxPopupHeight, spaceAbove)),
        };
    }
    return {
        placement,
        left,
        top: opts.caretRect.y + opts.caretRect.height + GAP,
        maxHeight: Math.max(0, Math.min(opts.maxPopupHeight, spaceBelow)),
    };
}

/**
 * Logical screen height in dp, from the framework's `Platform` snapshot of
 * `SystemInfo` (the same source `@sigx/lynx-navigation` reads for its screen
 * metrics). Falls back to a typical phone height in tests / non-Lynx hosts,
 * where `Platform.pixelHeight` is 0.
 */
export function screenHeightDp(fallback = 800): number {
    const px = Platform.pixelHeight;
    if (px > 0) return Math.round(px / (Platform.pixelRatio || 1));
    return fallback;
}
