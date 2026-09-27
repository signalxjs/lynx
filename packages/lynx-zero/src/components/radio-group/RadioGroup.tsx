/**
 * RadioGroup — one choice from a set, under a `string` model.
 *
 * ```tsx
 * <RadioGroup.Root model={() => state.plan}>
 *     <RadioGroup.Label>Plan</RadioGroup.Label>
 *     <RadioGroup.Item value="free">Free</RadioGroup.Item>
 *     <RadioGroup.Item value="pro">Pro</RadioGroup.Item>
 * </RadioGroup.Root>
 * // … or from data — `T` infers from `items`, the model is the item's key:
 * <RadioGroup.Root items={plans} itemKey={(p) => p.id} itemLabel={(p) => p.name} model={() => state.plan} />
 * ```
 *
 * The web's native radios (a shared generated `name`, arrow-key roving, the
 * hidden input) have no lynx counterpart: state lives in
 * `createControllableState`, each item row is its own tap target and
 * accessibility element, and the `hidden-input` part is omitted (legal —
 * the anatomy oracle walks RENDERED parts). `''` is the model's "nothing
 * chosen". Tapping the checked item is a no-op — a radio never unchecks.
 *
 * Data mode (`items`, zero's collection accessors — the same ones Select
 * takes) renders one item per entry; explicit children win entirely. The
 * `item` slot renders a custom label.
 *
 * `invalid` and `readonly` are facts about the group, restated on each item
 * and its control — the surfaces a skin paints (the anatomy's #267 rule).
 * `readonly` (the prop OR the Field's) keeps every item announced but
 * refuses every tap, with no press.
 */
import type { Define, JSXElement } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { ControllableState } from '@sigx/zero/behaviors/core';
import { createCollection, createControllableState, createInertState, useFieldContext } from '@sigx/zero/behaviors/core';
import type { FactoryBrands, JsxProps } from '@sigx/zero/contract/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies['radio-group'];

type Orientation = 'horizontal' | 'vertical';

interface RadioGroupContext {
    state: ControllableState<string>;
    disabled(): boolean;
    invalid(): boolean;
    required(): boolean;
    readonly(): boolean;
}

const useRadioGroupContext = defineInjectable<RadioGroupContext>(() => ({
    state: createInertState<string>(''),
    disabled: () => false,
    invalid: () => false,
    required: () => false,
    readonly: () => false,
}));

// ── Root ──

/** The props, generic over the item `T` (inferred from `items` by the exported root). */
export type RadioGroupRootProps<T = unknown> =
    & Define.Model<string>
    & Define.Prop<'defaultValue', string, false>
    & Define.Event<'valueChange', string>
    /** The data: one radio per item, in order. Explicit children win entirely. */
    & Define.Prop<'items', ReadonlyArray<T>, false>
    /** The model's string for an item. Default: `value` / `id`, or the primitive. */
    & Define.Prop<'itemKey', (item: T) => string, false>
    /** The label text. Default: `label`, or the key. */
    & Define.Prop<'itemLabel', (item: T) => string, false>
    /** Default: `disabled === true`. */
    & Define.Prop<'itemDisabled', (item: T) => boolean, false>
    /** A custom label for a generated item. */
    & Define.Slot<'item', { item: T }>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    /** Every item announced, none changes the value. The prop OR the Field's. */
    & Define.Prop<'readonly', boolean, false>
    /** Lay the items out along this axis (default `vertical`). */
    & Define.Prop<'orientation', Orientation, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const RadioGroupRootImpl = component<RadioGroupRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<string>(
        () => props.model,
        props.defaultValue ?? '',
        (v) => emit('valueChange', v),
    );
    const field = useFieldContext();
    // Data mode exactly when `items` is given and no children are — the
    // accessors and their defaults are the collection's (Select's).
    const items = (): ReadonlyArray<unknown> | undefined => (slots.default || props.items === undefined ? undefined : props.items);
    const collection = createCollection<unknown, string>({
        items,
        mode: () => (items() !== undefined ? 'data' : 'jsx'),
        itemKey: props.itemKey,
        itemLabel: props.itemLabel,
        itemDisabled: props.itemDisabled,
    });

    const ctx: RadioGroupContext = {
        state,
        disabled: () => !!props.disabled || field.disabled(),
        invalid: () => !!props.invalid || field.invalid(),
        required: () => !!props.required || field.required(),
        readonly: () => !!props.readonly || field.readonly(),
    };
    defineProvide(useRadioGroupContext, () => ctx);
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color,
        size: props.size ?? field.size(),
    }));
    const orientation = (): Orientation => props.orientation ?? 'vertical';

    const dataContent = (): JSXElement[] => collection.items().map((item) => {
        const key = collection.keyOf(item);
        // '' is the model's "nothing chosen": an item keyed with it could
        // never be told from no selection.
        if (key === '') throw new Error('[@sigx/lynx-zero] RadioGroup: an item keyed "" cannot be selected — give it a non-empty itemKey');
        return (
            // The label text names the item for the reader too, so a custom
            // `item` slot that renders no text still announces one.
            <RadioGroupItem value={key} disabled={collection.isItemDisabled(item)} label={collection.labelOf(item)} key={key}>
                {slots.item ? slots.item({ item }) : collection.labelOf(item)}
            </RadioGroupItem>
        );
    });

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                orientation: orientation(),
                flags: { disabled: ctx.disabled(), invalid: ctx.invalid(), required: ctx.required(), readonly: ctx.readonly() },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default ? slots.default() : items() ? dataContent() : null}
        </view>
    );
}, { name: 'RadioGroup.Root' });

/** The exported root: `T` infers from `items`; the model stays the item's string key. */
export type RadioGroupRoot = {
    <T>(props: JsxProps<RadioGroupRootProps<T>>): JSXElement;
} & FactoryBrands;

const RadioGroupRoot = RadioGroupRootImpl as unknown as RadioGroupRoot;

// ── Item ──

export type RadioGroupItemProps =
    /** The model value this item selects. (No events on this part — see the README.) */
    & Define.Prop<'value', string, true>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'class', string, false>
    /** Accessible name for the reader (the visible label slot is separate). */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const RadioGroupItem = component<RadioGroupItemProps>(({ props, slots }) => {
    const group = useRadioGroupContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled || group.disabled();
    const isChecked = (): boolean => group.state.value === props.value;
    const press = createPressFeedback({ isDisabled: () => disabled() || group.readonly() });

    return () => {
        const st = isChecked() ? 'checked' : 'unchecked';
        const invalid = group.invalid();
        const readonly = group.readonly();
        return (
            <view
                {...partBag(anatomy, 'item', {
                    state: st,
                    flags: { disabled: disabled(), invalid, readonly },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label, checked: st === 'checked', disabled: disabled(), readonly })}
                bindtap={() => {
                    if (disabled() || group.readonly() || isChecked()) return;
                    group.state.value = props.value;
                }}
                {...press.handlers}
            >
                <view {...partBag(anatomy, 'item-control', {
                    state: st,
                    flags: { disabled: disabled(), invalid, readonly, pressed: press.pressed() },
                    ...partAxes(axes()),
                })}
                >
                    <view {...partBag(anatomy, 'item-indicator', { state: st, ...partAxes(axes()) })} />
                </view>
                {slots.default
                    ? (
                        <text {...partBag(anatomy, 'item-label', { state: st, flags: { disabled: disabled() }, ...partAxes(axes()) })}>
                            {slots.default()}
                        </text>
                    )
                    : null}
            </view>
        );
    };
}, { name: 'RadioGroup.Item' });

// ── Label ──

export type RadioGroupLabelProps =
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** The group's visible name. */
const RadioGroupLabel = component<RadioGroupLabelProps>(({ props, slots }) => {
    const group = useRadioGroupContext();
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
}, { name: 'RadioGroup.Label' });

export const RadioGroup = compound(RadioGroupRoot, {
    Root: RadioGroupRoot,
    Item: RadioGroupItem,
    Label: RadioGroupLabel,
});
