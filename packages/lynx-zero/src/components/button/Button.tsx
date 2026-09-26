/**
 * Button — the press-feedback proof: `button` has no lynx element, so the
 * root is a `view` with `bindtap` + the button accessibility trait. A touch
 * scales the root on the main thread at once (tier 2, `createPressFeedback`)
 * and flows touch → pressed flag → `zx-f-pressed` → whatever the compiled
 * skin painted for the web's `[data-pressed]`. Disabled is the platform's
 * triple: handler guard, flag class for paint, accessibility status for the
 * reader.
 *
 * `loading` is zero's one machine state: work in flight. It blocks the press
 * like disabled does but paints as its own state (`zx-s-loading`, no
 * disabled fade — the label is what the user is waiting on), and renders the
 * `spinner` part before the label. The reader hears it as disabled — the
 * closest native spelling of `aria-disabled` + `aria-busy`.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { useFieldContext } from '@sigx/zero/behaviors/core';

export type ButtonRootProps =
    & Define.Prop<'disabled', boolean, false>
    /** Work in flight: blocks the press, stamps `loading`, shows the spinner part. */
    & Define.Prop<'loading', boolean, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
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
    const inert = () => disabled() || !!props.loading;
    // Read once: the feel is wired at setup (worklet handlers), not per render.
    const press = createPressFeedback({ isDisabled: inert, feel: props.pressFeel !== false });
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size, variant: props.variant, mods: props.mods,
    }));

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                state: props.loading ? 'loading' : undefined,
                flags: { disabled: disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label, disabled: inert() })}
            bindtap={() => {
                if (!inert()) emit('press');
            }}
            {...press.handlers}
        >
            {props.loading ? <view {...partBag(anatomy, 'spinner', partAxes(axes()))} /> : null}
            {slots.default?.()}
        </view>
    );
}, { name: 'Button.Root' });

export const Button = compound(ButtonRoot, { Root: ButtonRoot });
