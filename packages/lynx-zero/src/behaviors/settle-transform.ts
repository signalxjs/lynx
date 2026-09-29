/**
 * Settle a part's entry motion on its resting transform (#1320, #1324,
 * #1325).
 *
 * A part whose skin animates it in (a keyframe `animation`, or a
 * `transition` from a closed transform) and rests at the identity
 * (`transform: none`) can stop part-way on Lynx:
 *
 * - **Android**: a dialog or drawer open at mount (a cold deep link, or a
 *   restore after a pop) could freeze mid-flight. `animationend` fires, but
 *   the view keeps a mid-flight transform, and the engine never re-applies
 *   the static `transform: none` because that value never changed. A dialog
 *   panel came out 945–995px of 995px wide; a drawer panel's edge landed at
 *   835, 819, 793, 705 or ~500px of 840px.
 * - **iOS**: a drawer restored after a pop sat 2pt short of its open edge,
 *   every time.
 *
 * Neither `animation: none` nor `transition: none` clears it. A NEW inline
 * transform value does. So once the entry motion is over, the part states
 * an identity transform inline, and every later pin alternates between two
 * identity spellings (`scale(1)`, `translateX(0px)`) so each one is a
 * change the engine has to apply.
 *
 * When a pin happens:
 * - on the entry animation's end (`bindanimationend`), every time;
 * - on a transition's end (`bindtransitionend`) only while nothing is
 *   pinned yet (`pinOnTransition`, for a transition-driven entry). The pin
 *   itself can start a transition between the two identities, and that
 *   one's end must not pin again, or it would loop;
 * - at the last fallback timer of each entry, for an engine that sends no
 *   event.
 *
 * `arm()` starts an entry: the pins reset (the entry motion owns the
 * transform again) and the fallback timers are scheduled. Call it on every
 * open, and when the part is rendered again as on a fresh open (a restored
 * overlay: the new view replays the entry motion). `disarm()` clears the
 * timers and drops the pin, so an exit transition from the skin's closed
 * transform plays.
 *
 * A skin whose part rests at a non-identity transform would be overridden
 * by the pin: that is a contract of the parts that use this. @internal
 */
import { effect, signal } from '@sigx/lynx';

/**
 * The identity spellings a pin alternates between. Both are the identity,
 * so the part looks exactly as the skin's resting `transform: none` says.
 * @internal
 */
export const SETTLE_TRANSFORMS = ['scale(1)', 'translateX(0px)'] as const;

/**
 * The inline transform after `pins` pins: none before the first (the entry
 * motion owns the transform), then the settle transforms in turn. @internal
 */
export function settleTransform(pins: number): string | undefined {
    return pins > 0 ? SETTLE_TRANSFORMS[(pins - 1) % SETTLE_TRANSFORMS.length] : undefined;
}

export interface SettleTransformOptions {
    /**
     * When the fallback timers fire (ms after `arm()`). Each one calls
     * `onMotion`; the LAST one also pins. Default `[1000]`.
     */
    fallbackMs?: readonly number[];
    /**
     * Pin on a transition end while nothing is pinned yet: the part's entry
     * is a transition, not a keyframe animation. Default false (a
     * transition end then only reports motion).
     */
    pinOnTransition?: boolean;
    /**
     * Every motion end: an animation or transition end, and every fallback
     * timer. A part re-measures its anchored popups here (#1233).
     */
    onMotion?: () => void;
}

export interface SettleTransformHandle {
    /** The inline transform to state now (reactive): `undefined` before the first pin. */
    transform(): string | undefined;
    /** Start an entry: reset the pins and schedule the fallback timers. */
    arm(): void;
    /** Clear the timers and drop the pin (the part closed or unmounted). */
    disarm(): void;
    /** `bindanimationend`: the entry animation ended — pin. */
    onAnimationEnd(): void;
    /** `bindtransitionend`: report motion, and pin when `pinOnTransition` and nothing is pinned yet. */
    onTransitionEnd(): void;
}

/**
 * The settle behavior for one part. Call in setup; `disarm()` on unmount.
 * @internal
 */
export function createSettleTransform(options: SettleTransformOptions = {}): SettleTransformHandle {
    const fallbackMs = options.fallbackMs && options.fallbackMs.length > 0 ? options.fallbackMs : [1000];
    const state = signal({ pins: 0 });
    let timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = (): void => {
        for (const t of timers) clearTimeout(t);
        timers = [];
    };
    const motion = (): void => options.onMotion?.();
    const pin = (): void => {
        state.pins++;
        motion();
    };
    return {
        transform: () => settleTransform(state.pins),
        arm: () => {
            clearTimers();
            state.pins = 0;
            const last = fallbackMs.length - 1;
            timers = fallbackMs.map((ms, i) => setTimeout(i === last ? pin : motion, ms));
        },
        disarm: () => {
            clearTimers();
            state.pins = 0;
        },
        onAnimationEnd: pin,
        onTransitionEnd: () => {
            if (options.pinOnTransition && state.pins === 0) pin();
            else motion();
        },
    };
}

/**
 * Re-arm `settle` when an open overlay is rendered again as on a fresh
 * open: its screen was covered and is uncovered (`active` turns true while
 * `open`), so the outlet renders a new view that replays the entry motion
 * (#1308, #1325). Returns a stop. @internal
 */
export function rearmOnRestore(settle: SettleTransformHandle, active: () => boolean, open: () => boolean): () => void {
    let wasActive = active();
    const watcher = effect(() => {
        const now = active();
        if (now && !wasActive && open()) settle.arm();
        wasActive = now;
    });
    return () => watcher.stop();
}
