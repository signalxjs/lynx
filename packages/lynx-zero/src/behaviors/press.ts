/**
 * Press feedback on lynx — the counterpart of zero's `createPressFeedback`,
 * in two tiers that never fight:
 *
 * **Tier 1 — the pressed flag.** A touch drives a `pressed` signal, the
 * signal flows through `partBag` into the `pressed` flag/class, and the SKIN
 * styles the held state — the same recipe source that styles the web's
 * `[data-pressed]` compiles to `.zx-f-pressed` here. Always on.
 *
 * **Tier 2 — the main-thread feel (default on).** A background-thread round
 * trip is a frame or more late, and daisy's own press rule is a 1px sink —
 * too subtle under a thumb. So the touch handlers are MAIN-THREAD worklets:
 * on touch-down they scale the touched element in place (`transform:
 * scale(0.97)`, the legacy `Pressable` feel) with zero thread crossing, then
 * hand the tier-1 flag to the background thread with `runOnBackground`.
 * Touch-up/cancel restores `scale(1)`.
 *
 * Tier 2 writes ONLY inline `transform` (and `opacity`, when a caller opts in
 * with `feel.opacity`). The restore is an explicit value — lynx has no
 * verified way to remove one inline property from a worklet — so the written
 * property keeps an inline value after the first press. That is why opacity
 * is opt-in: the skins paint `disabled` with `opacity`, and a restored
 * inline `opacity: 1` would mask it from then on. `transform` is safe on the
 * parts that press (no recipe transforms them at rest); while a touch is
 * held, the scale supersedes a skin's pressed transform (daisy's 1px sink).
 *
 * Tier 2 turns itself off when the worklet transform did not run (unit tests,
 * any bundle without `@sigx/lynx-plugin`): the handlers fall back to plain
 * background-thread touch handlers driving tier 1 alone.
 *
 * Never presses while disabled: the background thread checks `isDisabled`,
 * and a main-thread mirror of it (kept in sync through `runOnMainThread`)
 * gates the worklet, so a disabled part neither scales nor flags.
 *
 * No pointer capture, no keyboard half, no `--press-*` ripple coordinates —
 * those are the web behavior's DOM machinery, and the capability set already
 * rejects recipes that depend on them outside web sections.
 */
import type { MainThread } from '@sigx/lynx';
import { effect, runOnBackground, runOnMainThread, signal, useMainThreadRef } from '@sigx/lynx';

/** Default tier-2 scale while held — the legacy `Pressable` / daisyui press. */
export const PRESSED_SCALE = 0.97;
/** The legacy press opacity — opt in with `feel: { opacity: PRESSED_OPACITY }`. */
export const PRESSED_OPACITY = 0.85;

/** Tier-2 feel: what the main thread writes while a touch is held. */
export interface LynxPressFeel {
    /** `transform: scale(n)` while held. Default `PRESSED_SCALE`; `1` disables it. */
    scale?: number;
    /**
     * Inline `opacity` while held; unset by default. Restored to `1` on
     * release, which masks any opacity the skin paints afterwards (disabled).
     */
    opacity?: number;
}

/** Tier 1 only: background touch handlers driving the pressed flag. */
export interface LynxTier1PressHandlers {
    bindtouchstart: () => void;
    bindtouchend: () => void;
    bindtouchcancel: () => void;
}

/** Tier 2: main-thread worklets (they hand the flag to the background). */
export interface LynxMainThreadPressHandlers {
    'main-thread-bindtouchstart': (event: MainThreadTouch) => void;
    'main-thread-bindtouchend': (event: MainThreadTouch) => void;
    'main-thread-bindtouchcancel': (event: MainThreadTouch) => void;
}

/** The spreadable touch handlers: exactly one family, never both. */
export type LynxPressHandlers = LynxTier1PressHandlers | LynxMainThreadPressHandlers;

/** The slice of a main-thread touch event the worklets read. */
export interface MainThreadTouch {
    currentTarget?: MainThread.Element | null;
}

interface LynxPressFeedbackBase {
    /** True while a touch is physically down on the part. */
    pressed(): boolean;
}

/**
 * Discriminated on `mainThread`: `true` when the main-thread feel is wired
 * (the worklet family), `false` for tier 1 alone — `feel: false`, or no
 * worklet transform (unit tests).
 */
export type LynxPressFeedback =
    | (LynxPressFeedbackBase & { readonly mainThread: false; handlers: LynxTier1PressHandlers })
    | (LynxPressFeedbackBase & { readonly mainThread: true; handlers: LynxMainThreadPressHandlers });

export interface LynxPressFeedbackOptions {
    /** Suppresses the pressed state (both tiers) while true. */
    isDisabled?: () => boolean;
    /**
     * The tier-2 main-thread feel. `true`/omitted = the default scale;
     * `false` = tier 1 only (the flag, no inline writes); an object tunes it.
     */
    feel?: boolean | LynxPressFeel;
}

export function createPressFeedback(options: LynxPressFeedbackOptions = {}): LynxPressFeedback {
    const pressed = signal(false);
    const disabled = (): boolean => !!options.isDisabled?.();
    const onDown = (): void => {
        if (disabled()) return;
        pressed.value = true;
    };
    const onUp = (): void => {
        pressed.value = false;
    };
    const tier1: LynxTier1PressHandlers = {
        bindtouchstart: onDown,
        bindtouchend: onUp,
        bindtouchcancel: onUp,
    };
    const feel = options.feel ?? true;
    if (feel === false) {
        return { pressed: () => pressed.value, handlers: tier1, mainThread: false };
    }

    // The SWC worklet transform turns every 'main thread' function into a
    // `{ _wkltId }` placeholder in this bundle. A plain function means it did
    // not run — no main thread to write from — so fall back to tier 1 before
    // allocating anything main-thread side.
    const probe = (): void => {
        'main thread';
    };
    if (typeof probe === 'function') {
        return { pressed: () => pressed.value, handlers: tier1, mainThread: false };
    }

    const tune: LynxPressFeel = feel === true ? {} : feel;
    const scale = tune.scale ?? PRESSED_SCALE;
    // -1 = "leave opacity alone": a worklet capture must stay a plain value.
    const opacity = tune.opacity ?? -1;

    // The main-thread mirror of `isDisabled`. Seeded once at creation
    // (INIT_MT_REF); later changes cross over through runOnMainThread — a
    // background `.current` write never reaches the main thread.
    const gate = useMainThreadRef<boolean>(disabled());

    // Worklets capture only plain values, the gate ref and background
    // closures (via runOnBackground): an imported helper does not survive
    // the capture, so the style writes are inlined in each body.
    const down = (event: MainThreadTouch): void => {
        'main thread';
        if (gate.current) return;
        const el = event && event.currentTarget;
        if (el) {
            if (opacity >= 0) el.setStyleProperties({ transform: 'scale(' + scale + ')', opacity: String(opacity) });
            else el.setStyleProperties({ transform: 'scale(' + scale + ')' });
        }
        runOnBackground(onDown)();
    };
    const up = (event: MainThreadTouch): void => {
        'main thread';
        const el = event && event.currentTarget;
        if (el) {
            if (opacity >= 0) el.setStyleProperties({ transform: 'scale(1)', opacity: '1' });
            else el.setStyleProperties({ transform: 'scale(1)' });
        }
        runOnBackground(onUp)();
    };

    const syncGate = runOnMainThread((value: boolean) => {
        'main thread';
        gate.current = value;
    });
    let lastGate = disabled();
    effect(() => {
        const next = disabled();
        if (next === lastGate) return;
        lastGate = next;
        void syncGate(next);
        // A part that turns disabled mid-press drops the flag now; the
        // worklet restores the scale on the touch-up that follows.
        if (next) pressed.value = false;
    });

    return {
        pressed: () => pressed.value,
        handlers: {
            'main-thread-bindtouchstart': down,
            'main-thread-bindtouchend': up,
            'main-thread-bindtouchcancel': up,
        },
        mainThread: true,
    };
}
