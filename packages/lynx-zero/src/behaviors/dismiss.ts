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
 * - a layer belongs to its SCREEN (#1308). A navigator keeps a covered
 *   screen mounted, so its open layers stay on the stack; each layer
 *   carries its screen's activity (`useScreenActive()`), and only ACTIVE
 *   layers count. A back press on the screen on top skips the covered
 *   screen's layers, and the interceptor is held only while an active
 *   layer exists, so a covered dialog never swallows back (or the iOS edge
 *   swipe) on the screen above it.
 *
 * Client-only module state, exactly like zero's: the stack is a UI-thread
 * singleton and never runs under SSR.
 */

import { addBackInterceptor, effect, effectScope, signal } from '@sigx/lynx';

export interface LynxDismissLayer {
    /** Close this layer (called for the INNERMOST active layer only). */
    dismiss(): void;
    /**
     * Whether the layer's screen is the one on top — a reactive read, pass
     * the owner's `useScreenActive()` (#1308). Omitted: always active.
     */
    active?: () => boolean;
}

const stack: LynxDismissLayer[] = [];

/** Bumped on every stack change: the array itself is not reactive. */
const version = signal({ n: 0 });

/**
 * The bump is deferred a microtask, like the overlay registry's writes: a
 * layer registers from an effect's FIRST run, inside the mount render pass,
 * where sigx drops signal writes. Every read goes to the array itself, so
 * only the NOTIFICATION waits; the interceptor is synced inline.
 */
function bump(): void {
    queueMicrotask(() => {
        version.n++;
    });
}

const isActive = (layer: LynxDismissLayer): boolean => !layer.active || layer.active();

/** The innermost layer whose screen is on top. Tracks what it reads. */
function topActiveLayer(): LynxDismissLayer | undefined {
    void version.n;
    for (let i = stack.length - 1; i >= 0; i--) {
        if (isActive(stack[i])) return stack[i];
    }
    return undefined;
}

/**
 * Whether any open layer belongs to the screen on top. A REACTIVE read:
 * the overlay outlet's iOS edge strip renders on it (#1312).
 */
export function hasActiveDismissLayer(): boolean {
    return topActiveLayer() !== undefined;
}

/** The back interceptor, held only while an ACTIVE layer is open. */
let releaseBack: (() => void) | null = null;

/**
 * Hold the interceptor exactly while an active layer is open. Re-entrant:
 * registering or releasing writes core's reactive interceptor count, and
 * that write may flush the watcher below into this same function before
 * the outer call has stored its handle. So the handle is claimed and
 * checked around each call, never with `??=` across it: a nested run
 * that got there first keeps its registration, and ours is dropped.
 */
function syncBackInterceptor(): void {
    if (hasActiveDismissLayer()) {
        if (releaseBack) return;
        const release = addBackInterceptor(dismissTopLayer);
        if (releaseBack) release();
        else releaseBack = release;
    } else if (releaseBack) {
        const release = releaseBack;
        releaseBack = null;
        release();
    }
}

/**
 * The watcher that follows screen activity: a covered screen's layers stop
 * claiming back, an uncovered one's claim it again. Created once, at module
 * load and in a DETACHED scope, never from the effect a layer registers
 * in: an effect born inside a component's mount pass does not track, and
 * one owned by that component would die with it. It re-runs on every
 * stack change (the deferred bump) and on every activity flip it read.
 */
effectScope(true).run(() => {
    effect(() => {
        syncBackInterceptor();
    });
});

/**
 * Register an open overlay as a dismiss layer. Returns the unregister
 * function for `onUnmounted`/close — safe to call more than once, and safe
 * out of order (a layer that closes for its own reasons removes itself
 * wherever it sits).
 */
export function registerDismissLayer(layer: LynxDismissLayer): () => void {
    stack.push(layer);
    bump();
    syncBackInterceptor();
    return () => {
        const index = stack.indexOf(layer);
        if (index === -1) return;
        stack.splice(index, 1);
        bump();
        syncBackInterceptor();
    };
}

/**
 * Dismiss the innermost ACTIVE layer. Returns true when a layer consumed
 * the request — the back interceptor hands the return value to the back
 * wiring, which navigates only when nothing on the screen on top was open.
 */
export function dismissTopLayer(): boolean {
    const top = topActiveLayer();
    if (!top) return false;
    top.dismiss();
    return true;
}

/** How many layers are open, on any screen. */
export function openLayerCount(): number {
    return stack.length;
}

/** @internal — test seam. */
export function clearDismissLayers(): void {
    stack.length = 0;
    version.n++;
    syncBackInterceptor();
}
