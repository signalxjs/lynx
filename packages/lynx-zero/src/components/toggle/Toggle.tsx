/**
 * Toggle — a button with one bit of state (zero's `toggle` scope, WAI-ARIA's
 * `aria-pressed` button). Button's shape plus a mode: the root is a `view`
 * with `bindtap` that flips `on|off`, the `button` trait, and the on-state
 * announced as `selected` — the native readers' spelling of a pressed
 * toggle button (there is no `aria-pressed` on lynx).
 *
 * Not a form control: a mode you flip, not a value you submit (Switch owns
 * that case). The model concept is `pressed` (`model` / `defaultPressed` /
 * `pressedChange`), zero's names.
 *
 * Press feedback is Button's two tiers: a touch scales the root on the main
 * thread at once and flows touch → `pressed` flag → `zx-f-pressed` → the
 * skin's held paint. The `pressed` FLAG (the finger is down) and the `on`
 * STATE (the mode is set) are independent — a held on-toggle carries both.
 * `press-animating` is the web runtime's ripple bookkeeping and has no lynx
 * counterpart; `focus-visible` is reachable through `ForceStates` only
 * (no keyboard focus on this platform), like every lynx-zero part.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, useFieldContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

export type ToggleRootProps =
    & Define.Model<boolean>
    & Define.Prop<'defaultPressed', boolean, false>
    & Define.Event<'pressedChange', boolean>
    & Define.Prop<'disabled', boolean, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Accessible name — required for icon-only toggles. */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const anatomy = anatomies.toggle;

const ToggleRoot = component<ToggleRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultPressed ?? false,
        (value) => emit('pressedChange', value),
    );
    const field = useFieldContext();
    const disabled = () => !!props.disabled || field.disabled();
    // Read once: the feel is wired at setup (worklet handlers), not per render.
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size ?? field.size(),
    }));

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                state: state.value ? 'on' : 'off',
                flags: { disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label, selected: state.value, disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) state.value = !state.value;
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Toggle.Root' });

export const Toggle = compound(ToggleRoot, { Root: ToggleRoot });
