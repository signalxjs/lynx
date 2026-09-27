/**
 * Checkbox — the tri-state form control without the web's hidden-input
 * trick: there are no forms on lynx, so state lives in
 * `createControllableState` and labelling in the accessibility mapping; the
 * `hidden-input` part is omitted (legal — the anatomy oracle walks RENDERED
 * parts).
 *
 * The model is a `boolean`, or — bound to a `string[]` — ARRAY MODE, where
 * several boxes sharing one model toggle their own `value`'s membership
 * (`<Checkbox.Root model={() => state.tags} value="news">`), the same
 * semantics sigx's checkbox processor gives the web. `checkedChange` always
 * reports THIS box's state.
 *
 * Inside a `CheckboxGroup.Root` the box belongs to the group: give it a
 * `value`, and it is checked while the group's model includes it; toggling
 * writes the group model and the group's flags reach it (ORed with its own).
 * A `parent` box in a group derives its state from the group instead —
 * `checked` when every one of the group's `allValues` is selected,
 * `unchecked` when none, `indeterminate` when some — and toggling it selects
 * all or none.
 *
 * The root is the tap target (the web's `<label>` click-through, done
 * directly); control/indicator are paint. `pressed` rides the control, where
 * the anatomy declares it. `readonly` (the prop, the Field's, or the
 * group's) keeps the box announced but refuses every tap, and — like a
 * disabled one — shows no press.
 *
 * `hideLabel` renders no visible label: the row, not the box's own text,
 * says what it is — pass `label` so the reader still names it.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, onUnmounted } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, toggleTriState, triState, useFieldContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { useCheckboxGroupContext } from '../checkbox-group/context.js';

type CheckedState = 'checked' | 'unchecked' | 'indeterminate';

export type CheckboxRootProps =
    & Define.Model<boolean | string[]>
    & Define.Prop<'defaultChecked', boolean, false>
    & Define.Event<'checkedChange', boolean>
    /** Show the mixed state (a standalone box; a group's `parent` box derives its own). */
    & Define.Prop<'indeterminate', boolean, false>
    /**
     * The membership key in array mode and inside a `CheckboxGroup` — where
     * every box needs one. Default `"on"`, as on the web.
     */
    & Define.Prop<'value', string, false>
    /**
     * Inside a `CheckboxGroup`: the tri-state "select all" box. Its state is
     * derived from the group (all / none / some of `allValues`) and toggling
     * it selects all or none. Outside a group it has no effect.
     */
    & Define.Prop<'parent', boolean, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    /** Announced, never toggled by a tap. The prop OR the Field's OR the group's. */
    & Define.Prop<'readonly', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Accessible name for the reader (the visible label slot is separate). */
    & Define.Prop<'label', string, false>
    /** Render no visible label — pass `label` so the reader still names the box. */
    & Define.Prop<'hideLabel', boolean, false>
    & Define.Slot<'default'>;

const anatomy = anatomies.checkbox;

const CheckboxRoot = component<CheckboxRootProps>(({ props, slots, emit }) => {
    const group = useCheckboxGroupContext();
    const inGroup = !group.inert;
    const itemValue = (): string => props.value ?? 'on';
    const isParent = (): boolean => inGroup && !!props.parent;
    const checkedOf = (v: boolean | string[]): boolean => (Array.isArray(v) ? v.includes(itemValue()) : !!v);
    const state = createControllableState<boolean | string[]>(
        () => props.model,
        props.defaultChecked ?? false,
        (v) => {
            // In a group the group's model is written, not this one; the
            // event is emitted by the tap itself below.
            if (!inGroup) emit('checkedChange', checkedOf(v));
        },
    );
    const field = useFieldContext();

    // A child box tells the group its value — what a parent box selects.
    if (inGroup && !props.parent) {
        onUnmounted(group.register({ value: itemValue }));
        if (props.value === undefined) {
            console.warn(
                '[@sigx/lynx-zero] Checkbox.Root inside a CheckboxGroup has no `value`: it is the membership key, '
                + 'so every such box would share "on". Pass a distinct `value` to each box.',
            );
        }
    }

    const parentState = (): CheckedState => triState(group.allValues(), group.state.value);
    const checkedState = (): CheckedState => {
        if (isParent()) return parentState();
        if (props.indeterminate) return 'indeterminate';
        if (inGroup) return group.state.value.includes(itemValue()) ? 'checked' : 'unchecked';
        return checkedOf(state.value) ? 'checked' : 'unchecked';
    };

    // A group's flags reach every box, ORed with the box's own (and the
    // Field's — inside a group the Field context is the group's inert one).
    const disabled = (): boolean => !!props.disabled || field.disabled() || group.disabled();
    const invalid = (): boolean => !!props.invalid || field.invalid() || group.invalid();
    const required = (): boolean => !!props.required || field.required() || group.required();
    const readonly = (): boolean => !!props.readonly || field.readonly() || group.readonly();
    const press = createPressFeedback({ isDisabled: () => disabled() || readonly() });
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color,
        size: props.size ?? field.size(),
    }));

    const toggle = (): void => {
        if (disabled() || readonly()) return;
        if (isParent()) {
            group.state.value = toggleTriState(group.allValues(), group.state.value);
            emit('checkedChange', parentState() === 'checked');
            return;
        }
        if (inGroup) {
            const v = itemValue();
            const current = group.state.value;
            const next = !current.includes(v);
            group.state.value = next ? [...current, v] : current.filter((x) => x !== v);
            emit('checkedChange', next);
            return;
        }
        const current = state.value;
        if (Array.isArray(current)) {
            const v = itemValue();
            state.value = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
        } else {
            // The mixed look is the app's (`indeterminate`); a tap flips the
            // underlying checkedness, as a native mixed checkbox does.
            state.value = !current;
        }
    };

    return () => {
        const st = checkedState();
        return (
            <view
                {...partBag(anatomy, 'root', {
                    state: st,
                    flags: { disabled: disabled(), invalid: invalid(), required: required(), readonly: readonly() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({
                    trait: 'button',
                    label: props.label,
                    checked: st === 'checked',
                    mixed: st === 'indeterminate',
                    disabled: disabled(),
                    readonly: readonly(),
                })}
                bindtap={toggle}
                {...press.handlers}
            >
                <view {...partBag(anatomy, 'control', {
                    state: st,
                    flags: { disabled: disabled(), invalid: invalid(), readonly: readonly(), pressed: press.pressed() },
                    ...partAxes(axes()),
                })}
                >
                    <view {...partBag(anatomy, 'indicator', { state: st, ...partAxes(axes()) })} />
                </view>
                {slots.default && !props.hideLabel
                    ? (
                        <text {...partBag(anatomy, 'label', { state: st, flags: { disabled: disabled() }, ...partAxes(axes()) })}>
                            {slots.default()}
                        </text>
                    )
                    : null}
            </view>
        );
    };
}, { name: 'Checkbox.Root' });

export const Checkbox = compound(CheckboxRoot, { Root: CheckboxRoot });
