/**
 * Dismissal layers on lynx — the innermost-first stack zero's dismiss
 * behavior keeps module-internally (its DOM listener wiring made the stack
 * inseparable there; this is the same ~30 lines with lynx's triggers).
 *
 * What differs from the web is WHO detects the dismissal gesture:
 *
 * - "outside press" has no `document` to listen on. The overlay that owns a
 *   layer renders its own backdrop (a TouchGuard for modal surfaces, a
 *   transparent one for light dismiss) and calls `dismissTopLayer()` from
 *   its tap handler — the stack then closes the INNERMOST layer, which is
 *   what makes a popover inside a dialog close before the dialog.
 * - there is no Escape key. A hardware back-button hook (lynx-navigation)
 *   can call `dismissTopLayer()` later; nothing here assumes it exists.
 *
 * Client-only module state, exactly like zero's: the stack is a UI-thread
 * singleton and never runs under SSR.
 */

export interface LynxDismissLayer {
    /** Close this layer (called for the INNERMOST layer only). */
    dismiss(): void;
}

const stack: LynxDismissLayer[] = [];

/**
 * Register an open overlay as a dismiss layer. Returns the unregister
 * function for `onUnmounted`/close — safe to call more than once, and safe
 * out of order (a layer that closes for its own reasons removes itself
 * wherever it sits).
 */
export function registerDismissLayer(layer: LynxDismissLayer): () => void {
    stack.push(layer);
    return () => {
        const index = stack.indexOf(layer);
        if (index !== -1) stack.splice(index, 1);
    };
}

/**
 * Dismiss the innermost open layer. Returns true when a layer consumed the
 * request — a back-button integration uses the return value to decide
 * whether the event was handled or should navigate.
 */
export function dismissTopLayer(): boolean {
    const top = stack[stack.length - 1];
    if (!top) return false;
    top.dismiss();
    return true;
}

/** How many layers are open — the toast viewport uses it to stay on top. */
export function openLayerCount(): number {
    return stack.length;
}

/** @internal — test seam. */
export function clearDismissLayers(): void {
    stack.length = 0;
}
