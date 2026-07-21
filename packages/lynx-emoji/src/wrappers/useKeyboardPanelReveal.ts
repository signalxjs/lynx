import { onUnmounted, signal, watch } from '@sigx/lynx';
import { useKeyboardLift } from '@sigx/lynx-keyboard';

export type PanelRevealMode = 'closed' | 'open' | 'closing';

export interface KeyboardPanelRevealOptions {
    /** Blur the composer input, so the keyboard dismisses and REVEALS the panel. */
    blur: () => void;
    /** Focus the composer input, so the keyboard rises back OVER the panel. */
    focus: () => void;
    /**
     * How long the space handoff waits after the returning keyboard's inset
     * event. Must outlast `KeyboardStickyView`'s MT lift tween (250ms) —
     * both are started by the same event. Default 350.
     */
    settleMs?: number;
    /**
     * Handoff fallback when no keyboard ever rises after `close()` (focus
     * lost, hardware keyboard). Default 600.
     */
    noKeyboardMs?: number;
}

export interface KeyboardPanelReveal {
    /** Current mode — drive the toggle button's icon off `'open'`. */
    mode: () => PanelRevealMode;
    /**
     * True while the panel must stay PAINTED and the bar PINNED (`open` and
     * `closing`) — feed it to both `KeyboardStickyView`'s `pinned` and
     * `KeyboardPanelPicker`'s `open`.
     */
    engaged: () => boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
}

/**
 * The WhatsApp keyboard ⇄ panel reveal, as a state machine — the app
 * animates NOTHING; the system keyboard's own show/hide animation does all
 * visible motion:
 *
 *  - `open`: the bar is pinned and the panel painted in the keyboard's
 *    remembered space; blurring lets the keyboard slide down and REVEAL it.
 *  - `closing`: the keyboard is rising back OVER the still-painted panel.
 *    The inset event reports the keyboard's FINAL height once, at the START
 *    of its visual rise — the sticky view's MT tween is still in flight —
 *    so the space handoff waits `settleMs` after that event. Handing off on
 *    the event itself re-registers the bar's transform binding mid-tween
 *    and the bar visibly rides up with the keyboard (the bug this state
 *    exists to prevent).
 *  - `closed`: the panel is parked; the bar tracks the live keyboard.
 *
 * The handoff itself is a single frame: unpin + collapse are equal numbers
 * applied together, so the bar cannot move (a returning keyboard whose
 * height changed since the panel opened shifts the bar once at this frame —
 * `KeyboardPanelPicker` adopts the new height for the next cycle).
 */
export function useKeyboardPanelReveal(opts: KeyboardPanelRevealOptions): KeyboardPanelReveal {
    const settleMs = opts.settleMs ?? 350;
    const noKeyboardMs = opts.noKeyboardMs ?? 600;

    const mode = signal<PanelRevealMode>('closed');
    const lift = useKeyboardLift();
    // Whether a keyboard has ever risen on this screen — if not, `close()`
    // has nothing to wait for and hands off immediately.
    let everLifted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
    const handOffIn = (ms: number): void => {
        clearTimer();
        timer = setTimeout(() => {
            timer = null;
            if (mode.value === 'closing') mode.value = 'closed';
        }, ms);
    };

    watch(() => lift.value, (h: number) => {
        if (h > 0) everLifted = true;
        // The returning keyboard announced itself — schedule the settle
        // (replacing the no-keyboard fallback with the precise timer).
        if (mode.value === 'closing' && h > 0) handOffIn(settleMs);
    });
    onUnmounted(clearTimer);

    const open = (): void => {
        if (mode.value === 'open') return;
        clearTimer();
        mode.value = 'open';   // pin + paint FIRST (same frame)…
        opts.blur();           // …then the keyboard reveals it.
    };
    const close = (): void => {
        if (mode.value !== 'open') return;
        mode.value = everLifted ? 'closing' : 'closed';
        opts.focus();
        if (mode.value === 'closing') handOffIn(noKeyboardMs);
    };

    return {
        // sigx's signal() widens primitive-union reads to string — assert back.
        mode: () => mode.value as PanelRevealMode,
        engaged: () => mode.value !== 'closed',
        open,
        close,
        toggle: (): void => {
            if (mode.value === 'open') close();
            else open();
        },
    };
}
