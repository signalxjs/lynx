/**
 * Button — the press-feedback proof: `button` has no lynx element, so the
 * root is a `view` with `bindtap` + the button accessibility trait, and the
 * held state flows touch → pressed flag → `zx-f-pressed` → whatever the
 * compiled skin painted for the web's `[data-pressed]`. Disabled is the
 * platform's triple: handler guard, flag class for paint, accessibility
 * status for the reader.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { useFieldContext } from '@sigx/zero/behaviors/core';

export type ButtonRootProps =
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Prop<'mods', Record<string, boolean | undefined>, false>
    & Define.Prop<'class', string, false>
    /** Accessible name — required when the content is not plain text. */
    & Define.Prop<'label', string, false>
    & Define.Event<'press'>
    & Define.Slot<'default'>;

const anatomy = anatomies.button;

const ButtonRoot = component<ButtonRootProps>(({ props, slots, emit }) => {
    const field = useFieldContext();
    const disabled = () => !!props.disabled || field.disabled();
    const press = createPressFeedback({ isDisabled: disabled });
    const axes = (): VariantAxes => ({
        color: props.color, size: props.size, variant: props.variant, mods: props.mods,
    });
    provideVariantAxes(axes);

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label, disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) emit('press');
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Button.Root' });

export const Button = compound(ButtonRoot, { Root: ButtonRoot });
