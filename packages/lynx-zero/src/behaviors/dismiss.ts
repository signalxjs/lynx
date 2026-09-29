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
 * - there is no Escape key; the Android back button is its stand-in
 *   (#1290). While any layer is open the stack holds a back interceptor
 *   (`addBackInterceptor`), and lynx-navigation's back wiring offers every
 *   press to it before it pops: the press dismisses the INNERMOST layer and
 *   never navigates. A layer that refuses to close (a non-dismissible
 *   dialog) still consumes the press. Without lynx-navigation nothing calls
 *   the interceptor, and back keeps its platform default.
 *
 * Client-only module state, exactly like zero's: the stack is a UI-thread
 * singleton and never runs under SSR.
 */

import { addBackInterceptor } from '@sigx/lynx';

export interface LynxDismissLayer {
    /** Close this layer (called for the INNERMOST layer only). */
    dismiss(): void;
}

const stack: LynxDismissLayer[] = [];

/** The back interceptor, held only while a layer is open. */
let releaseBack: (() => void) | null = null;

function syncBackInterceptor(): void {
    if (stack.length > 0) {
        releaseBack ??= addBackInterceptor(dismissTopLayer);
    } else if (releaseBack) {
        releaseBack();
        releaseBack = null;
    }
}

/**
 * Register an open overlay as a dismiss layer. Returns the unregister
 * function for `onUnmounted`/close — safe to call more than once, and safe
 * out of order (a layer that closes for its own reasons removes itself
 * wherever it sits).
 */
export function registerDismissLayer(layer: LynxDismissLayer): () => void {
    stack.push(layer);
    syncBackInterceptor();
    return () => {
        const index = stack.indexOf(layer);
        if (index !== -1) stack.splice(index, 1);
        syncBackInterceptor();
    };
}

/**
 * Dismiss the innermost open layer. Returns true when a layer consumed the
 * request — the back interceptor hands the return value to the back wiring,
 * which navigates only when nothing was open.
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
    syncBackInterceptor();
}
