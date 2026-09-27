/**
 * CheckboxGroup — a labelled group of `Checkbox.Root`s under one `string[]`
 * model, with an optional derived tri-state parent box.
 *
 * ```tsx
 * <CheckboxGroup.Root model={() => state.toppings} allValues={['ham', 'olives', 'basil']}>
 *     <CheckboxGroup.Label>Toppings</CheckboxGroup.Label>
 *     <Checkbox.Root parent>All toppings</Checkbox.Root>
 *     <Checkbox.Root value="ham">Ham</Checkbox.Root>
 *     <Checkbox.Root value="olives">Olives</Checkbox.Root>
 *     <Checkbox.Root value="basil">Basil</Checkbox.Root>
 * </CheckboxGroup.Root>
 * ```
 *
 * The group renders only its own two parts; the boxes inside are ordinary
 * `checkbox` scope parts (a boxed `Checkbox.Root` reads the group from
 * context), so a skin styles a box once, grouped or not. A box inside the
 * group needs a `value`: it is checked while the group's model includes it,
 * and toggling it writes the group model. The group's `disabled` /
 * `invalid` / `required` / `readonly` — the prop OR an enclosing Field's —
 * reach every box.
 *
 * A `parent` box derives its state from `allValues` (else every child's
 * value): `checked` when all are selected, `unchecked` when none,
 * `indeterminate` when some. Toggling it selects all or none of them.
 *
 * Unlike the web there is no form to post to, so no `name`/`form`, and
 * `required` is a flag the skin and the reader see — nothing blocks a
 * submit. The group's `size` reaches the boxes that set none of their own
 * (through the Field context, as on the web); its `color` inks the group
 * label only. The root is NOT an accessibility element — on lynx that would
 * fold every box into one node — so each box announces itself.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, provideFieldContext, useFieldContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import type { CheckboxGroupContext } from './context.js';
import { createEntryRegistry, useCheckboxGroupContext } from './context.js';

const anatomy = anatomies['checkbox-group'];

type Orientation = 'horizontal' | 'vertical';

export type CheckboxGroupRootProps =
    & Define.Model<string[]>
    & Define.Prop<'defaultValue', string[], false>
    & Define.Event<'valueChange', string[]>
    /**
     * The values a `parent` box selects and derives its state from. Default:
     * the values of every child box rendered in the group.
     */
    & Define.Prop<'allValues', string[], false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    /** "At least one": flagged for the skin and the reader. */
    & Define.Prop<'required', boolean, false>
    /** Every box stays announced, none toggles. The prop OR the Field's. */
    & Define.Prop<'readonly', boolean, false>
    /** Lay the boxes out along this axis (default `vertical`). */
    & Define.Prop<'orientation', Orientation, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const CheckboxGroupRoot = component<CheckboxGroupRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<string[]>(
        () => props.model,
        props.defaultValue ?? [],
        (v) => emit('valueChange', v),
    );
    const field = useFieldContext();
    const registry = createEntryRegistry();
    const orientation = (): Orientation => props.orientation ?? 'vertical';

    const ctx: CheckboxGroupContext = {
        inert: false,
        state,
        disabled: () => !!props.disabled || field.disabled(),
        invalid: () => !!props.invalid || field.invalid(),
        required: () => !!props.required || field.required(),
        readonly: () => !!props.readonly || field.readonly(),
        orientation,
        allValues: () => props.allValues ?? registry.entries().map((e) => e.value()),
        register: registry.register,
    };
    defineProvide(useCheckboxGroupContext, () => ctx);
    // The ROOT is the field's control; the boxes inside must not each adopt
    // its flags a second time. They see a field of their own — inert — that
    // still hands down the size.
    provideFieldContext({
        inert: true,
        ids: { control: '', label: '', description: '', error: '' },
        disabled: () => false,
        invalid: () => false,
        required: () => false,
        readonly: () => false,
        size: () => props.size ?? field.size(),
        describedBy: () => undefined,
    });
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color,
        size: props.size ?? field.size(),
    }));

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                orientation: orientation(),
                flags: { disabled: ctx.disabled(), invalid: ctx.invalid(), required: ctx.required(), readonly: ctx.readonly() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'CheckboxGroup.Root' });

export type CheckboxGroupLabelProps =
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** The group's visible name. */
const CheckboxGroupLabel = component<CheckboxGroupLabelProps>(({ props, slots }) => {
    const group = useCheckboxGroupContext();
    const axes = useVariantAxes();
    return () => (
        <text
            {...partBag(anatomy, 'label', {
                flags: { disabled: group.disabled(), invalid: group.invalid(), required: group.required() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </text>
    );
}, { name: 'CheckboxGroup.Label' });

export const CheckboxGroup = compound(CheckboxGroupRoot, {
    Root: CheckboxGroupRoot,
    Label: CheckboxGroupLabel,
});
