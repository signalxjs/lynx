/**
 * Press feedback on lynx — the counterpart of zero's `createPressFeedback`,
 * tier 1: touch events drive a `pressed` signal, the signal flows through
 * `partBag` into the `pressed` flag/class, and the SKIN styles the held
 * state — the same recipe source that styles the web's `[data-pressed]`
 * compiles to `.zx-f-pressed` here. One frame of background-thread latency
 * is acceptable for a tint; the platform-idiomatic tier 2 (a main-thread
 * worklet writing inline opacity/scale, the lynx-gestures Pressable move)
 * is an opt-in follow-up and touches ONLY transform/opacity, properties the
 * recipes never own on interactive roots — so the two tiers can never fight.
 *
 * No pointer capture, no keyboard half, no `--press-*` ripple coordinates —
 * those are the web behavior's DOM machinery, and the capability set already
 * rejects recipes that depend on them outside web sections.
 */
import { signal } from '@sigx/lynx';

export interface LynxPressFeedback {
    /** True while a touch is physically down on the part. */
    pressed(): boolean;
    /** Spread onto the gesture-owning element. */
    handlers: {
        bindtouchstart: () => void;
        bindtouchend: () => void;
        bindtouchcancel: () => void;
    };
}

export interface LynxPressFeedbackOptions {
    /** Suppresses the pressed state entirely while true. */
    isDisabled?: () => boolean;
}

export function createPressFeedback(options: LynxPressFeedbackOptions = {}): LynxPressFeedback {
    const pressed = signal(false);
    return {
        pressed: () => pressed.value,
        handlers: {
            bindtouchstart: () => {
                if (options.isDisabled?.()) return;
                pressed.value = true;
            },
            bindtouchend: () => {
                pressed.value = false;
            },
            bindtouchcancel: () => {
                pressed.value = false;
            },
        },
    };
}
