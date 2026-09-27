/**
 * Field — the wiring hub for a labeled form control, on zero's own
 * `FieldContext` (`@sigx/zero/behaviors/core`). Every lynx-zero form control
 * already reads that context (Switch, Slider, Select, Button, Input,
 * Textarea — and NumberInput through `createFormControl`), so a control
 * inside a Field adopts its disabled/invalid/required/readonly flags and,
 * when it sets none of its own, its `size`:
 *
 * ```tsx
 * <Field.Root invalid={!!error} required>
 *     <Field.Label>Email</Field.Label>
 *     <Input.Root model={() => state.email} type="email">
 *         <Input.Control><Input.Input placeholder="you@example.com" /></Input.Control>
 *     </Input.Root>
 *     <Field.Description>We never share it.</Field.Description>
 *     {error ? <Field.Error>{error}</Field.Error> : null}
 * </Field.Root>
 * ```
 *
 * The enclosing `Fieldset.Root`'s flags (zero's `FieldsetContext`) are the
 * Field's too, so a Field inside a disabled fieldset dims with it.
 *
 * What the platform changes:
 *
 * - **No `<label for>`.** A tap on `Field.Label` focuses the control
 *   instead: the control registers itself through the context's `report`
 *   seam (zero#284's validation surface — its `focus()` is exactly this),
 *   and the label calls the first registered one.
 * - **No constraint validation** (no forms, no `ValidityState`). `invalid`
 *   is the app's to set, so `validate`/`validateOn` and `Field.Error`'s
 *   `match` have no lynx counterpart; a `Field.Error` renders whenever it is
 *   rendered — mount it while there is an error to say.
 * - **No `aria-describedby`.** The ids are still minted and carried on the
 *   context (other controls read `ids.control`), but nothing on lynx
 *   resolves an IDREF.
 * - **No `::after`.** The web skin marks a required label with a pseudo-
 *   element asterisk; lynx has none, so `required` reaches the label as its
 *   flag class only (and the reader through the control's own status).
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { FieldContext, FieldValidityReport } from '@sigx/zero/behaviors/core';
import { createId, provideFieldContext, useFieldContext, useFieldsetContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { VISUALLY_HIDDEN } from '../../shared/native-text.js';

const anatomy = anatomies.field;

export type FieldRootProps =
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    /** Announced, never edited — adopted by every control inside. */
    & Define.Prop<'readonly', boolean, false>
    /** Accents the label (daisy: through the role's ink). */
    & Define.Prop<'color', string, false>
    /** The whole field's size — a control without its own renders this one. */
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const FieldRoot = component<FieldRootProps>(({ props, slots }) => {
    const baseId = createId('zx-field');
    const fieldset = useFieldsetContext();
    const disabled = (): boolean => !!props.disabled || fieldset.disabled();
    const readonly = (): boolean => !!props.readonly || fieldset.readonly();
    const invalid = (): boolean => !!props.invalid || fieldset.invalid();
    const required = (): boolean => !!props.required;
    // Registration order, first wins — zero's rule. Not reactive: only a
    // label tap reads it.
    const reports: FieldValidityReport[] = [];

    const ctx: FieldContext = {
        inert: false,
        ids: {
            control: `${baseId}-control`,
            label: `${baseId}-label`,
            description: `${baseId}-desc`,
            error: `${baseId}-error`,
        },
        disabled,
        invalid,
        required,
        readonly,
        size: () => props.size,
        describedBy: () => undefined,
        report: (report) => {
            reports.push(report);
            return () => {
                const i = reports.indexOf(report);
                if (i >= 0) reports.splice(i, 1);
            };
        },
    };
    provideFieldContext(ctx);
    provideFieldFocus(() => {
        if (!disabled()) reports[0]?.focus();
    });

    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: disabled(), invalid: invalid(), required: required(), readonly: readonly() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Field.Root' });

// The label's tap target — module-private, so only Field.Root provides it.
const useFieldFocus = defineInjectable<() => void>(() => () => {});
function provideFieldFocus(focus: () => void): void {
    defineProvide(useFieldFocus, () => focus);
}

export type FieldLabelProps =
    /** Keep it for the reader but take it off screen. */
    & Define.Prop<'visuallyHidden', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const FieldLabel = component<FieldLabelProps>(({ props, slots }) => {
    const field = useFieldContext();
    const focus = useFieldFocus();
    const axes = useVariantAxes();
    return () => {
        const bag = partBag(anatomy, 'label', {
            flags: { disabled: field.disabled(), invalid: field.invalid(), required: field.required() },
            ...partAxes(axes()),
            class: props.class,
        });
        if (props.visuallyHidden) bag['data-visually-hidden'] = '';
        return (
            <text {...bag} style={props.visuallyHidden ? VISUALLY_HIDDEN : undefined} {...{ bindtap: () => focus() }}>
                {slots.default?.()}
            </text>
        );
    };
}, { name: 'Field.Label' });

export type FieldPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const FieldDescription = component<FieldPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'description', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Field.Description' });

/** Rendered whenever it is mounted — lynx has no constraint validation to `match`. */
const FieldError = component<FieldPartProps>(({ props, slots }) => {
    const field = useFieldContext();
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'error', { flags: { invalid: field.invalid() }, ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Field.Error' });

export const Field = compound(FieldRoot, {
    Root: FieldRoot,
    Label: FieldLabel,
    Description: FieldDescription,
    Error: FieldError,
});
