/**
 * The soft keyboard, as a modal overlay needs it (#1232).
 *
 * A dialog renders through the overlay portal, into the full-window outlet
 * layer: an app cannot wrap it in a `KeyboardAvoidingView`, so the overlay
 * has to make room for the keyboard itself. On the web the browser shrinks
 * the visual viewport and scrolls the focused control into view; on lynx
 * nothing moves, and the keyboard covered the lower half of the panel — the
 * focused textarea and the footer's buttons.
 *
 * The height comes from the same channel `@sigx/lynx-keyboard` reads: the
 * native safe-area publisher (`@sigx/lynx-safe-area`) writes
 * `lynx.__globalProps.safeArea.keyboard` and fires `safeAreaChanged` on every
 * change. It is read provider-free, so an app does not need a
 * `<SafeAreaProvider>` for its dialogs to avoid the keyboard. Without the
 * native publisher (web, tests) the height stays 0, and nothing moves.
 *
 * One subscription for the whole app, held only while some overlay needs it
 * (`acquireKeyboard`): a screen of closed dialogs subscribes nothing.
 */
import { signal } from '@sigx/lynx';
import { readGlobalSafeArea, subscribeSafeArea } from '@sigx/lynx-safe-area';

const state = signal({ height: 0 });
let holders = 0;
let unsubscribe: (() => void) | null = null;

const clean = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null;

/**
 * Start following the keyboard: seeds the height from `__globalProps` (a
 * dialog that opens over an already-raised keyboard is right on its first
 * frame) and subscribes to the live channel. Reference counted — the
 * subscription is dropped when the last holder releases. Returns an
 * idempotent release.
 */
export function acquireKeyboard(): () => void {
    if (holders++ === 0) {
        state.height = readGlobalSafeArea().keyboard;
        unsubscribe = subscribeSafeArea((raw) => {
            // A payload without the key keeps the last height: the
            // publishers always send it, but a partial republish must not
            // read as "the keyboard closed".
            const next = clean(raw.keyboard);
            if (next !== null) state.height = next;
        });
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (--holders === 0) {
            unsubscribe?.();
            unsubscribe = null;
            state.height = 0;
        }
    };
}

/** The keyboard's height (dp/pt), 0 when hidden or not followed. Reactive. */
export function keyboardHeight(): number {
    // Zeroed when the last holder releases, so a stale height never leaks.
    return state.height;
}

/**
 * How much of the OUTLET the keyboard actually covers, from its bottom edge.
 *
 * The keyboard height is measured against the window, and on iOS the
 * window never moves: the keyboard covers its bottom `keyboard` points. An
 * Android activity with `adjustResize` may instead shrink the whole lynx
 * view above the keyboard, so the outlet's own bottom edge already sits on
 * top of it — lifting the panel by the keyboard height again would lift it
 * twice. `fullHeight` is the outlet's height with no keyboard (the tallest
 * the host has laid it out at this width): whatever the window lost to a
 * resize is subtracted from the overlap. Pure.
 */
export function keyboardOverlap(keyboard: number, outletHeight: number, fullHeight: number): number {
    if (!(keyboard > 0) || !(outletHeight > 0)) return 0;
    const resized = Math.max(0, (fullHeight > 0 ? fullHeight : outletHeight) - outletHeight);
    return Math.max(0, Math.round(keyboard - resized));
}
