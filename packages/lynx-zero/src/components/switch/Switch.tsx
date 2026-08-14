/**
 * Switch — the form-control shape without the web's hidden-input trick:
 * there are no forms on lynx, so state lives in `createControllableState`
 * and labelling in the accessibility mapping; the `hidden-input` part is
 * omitted (legal — the anatomy oracle walks RENDERED parts).
 *
 * The root is the tap target (the web's `<label>` click-through, done
 * directly); control/thumb are paint. The `pressed` flag rides the control —
 * where the anatomy declares it, and where a skin tints the held track.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { createControllableState, useFieldContext } from '@sigx/zero/behaviors/core';

export type SwitchRootProps =
    & Define.Model<boolean>
    & Define.Prop<'defaultChecked', boolean, false>
    & Define.Event<'checkedChange', boolean>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Accessible name for the reader (the visible label slot is separate). */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const anatomy = anatomies.switch;

const SwitchRoot = component<SwitchRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultChecked ?? false,
        (value) => emit('checkedChange', value),
    );
    const field = useFieldContext();
    const disabled = () => !!props.disabled || field.disabled();
    const invalid = () => !!props.invalid || field.invalid();
    const press = createPressFeedback({ isDisabled: disabled });
    const st = () => (state.value ? 'checked' : 'unchecked');
    const axes = (): VariantAxes => ({ color: props.color, size: props.size });
    provideVariantAxes(axes);

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                state: st(),
                flags: { disabled: disabled(), invalid: invalid(), required: props.required },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label, checked: state.value, disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) state.value = !state.value;
            }}
            {...press.handlers}
        >
            <view {...partBag(anatomy, 'control', {
                state: st(),
                flags: { disabled: disabled(), invalid: invalid(), pressed: press.pressed() },
                ...partAxes(axes()),
            })}
            >
                <view {...partBag(anatomy, 'thumb', { state: st(), ...partAxes(axes()) })} />
            </view>
            {slots.default
                ? (
                    <text {...partBag(anatomy, 'label', { state: st(), flags: { disabled: disabled() }, ...partAxes(axes()) })}>
                        {slots.default()}
                    </text>
                )
                : null}
        </view>
    );
}, { name: 'Switch.Root' });

export const Switch = compound(SwitchRoot, { Root: SwitchRoot });
