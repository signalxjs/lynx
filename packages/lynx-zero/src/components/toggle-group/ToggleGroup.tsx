/**
 * ToggleGroup — a row (or column) of two-state buttons under one value
 * model (zero's `toggle-group` scope), single or multiple selection.
 *
 * ```tsx
 * <ToggleGroup.Root model={() => state.align}>
 *     <ToggleGroup.Item value="left"><text>Left</text></ToggleGroup.Item>
 *     <ToggleGroup.Item value="center"><text>Center</text></ToggleGroup.Item>
 * </ToggleGroup.Root>
 * ```
 *
 * The model follows `multiple`, zero's (and Select's) rule: single mode holds
 * the pressed value as a `string` (`''` when none), `multiple` a `string[]`.
 * The exported root is typed through an overload cast, so a string model
 * binds a single group and an array a multiple one.
 *
 * What the platform changes:
 * - **No roving focus.** There is no keyboard: activation is a tap on an
 *   item, so zero's list controller / roving tab stop have nothing to do
 *   and are not wired. Items need no registration.
 * - **No `hidden-input`.** No forms on lynx; the anatomy oracle walks
 *   RENDERED parts, so omitting it is legal (the Switch and Select
 *   precedent). `invalid`/`required` stay as the root's flags — paint and
 *   Field wiring, not a constraint.
 * - **No group role.** lynx has no `role="group"`; marking the root an
 *   accessible element would hide its items from the reader on iOS, so the
 *   root carries no accessibility props and each item is announced as a
 *   `button`, `selected` while on.
 * - **The join's ends are stamped.** lynx has no `:first-child` or
 *   `:last-child`, so the root tracks its items in mount order and stamps
 *   the end items `first` / `last` (the `zx-m-first` / `zx-m-last`
 *   modifier classes, `data-mod-first` / `data-mod-last`): the skin rounds
 *   their outer corners and drops the first item's leading seam
 *   (signalxjs/lynx#1218). An item mounted later (a conditional one) joins
 *   the END of that order, whatever its position in the row.
 *
 * Each item owns its own press feedback (a shared instance would light every
 * item at once), tier 2 by default: the touched item scales on the main
 * thread and its `pressed` flag paints the skin's held state. `selected`
 * doubles the on-state as a presence flag, as zero stamps it.
 *
 * The item takes a `value` prop and emits nothing — runtime-core resolves a
 * component's event handlers through `props.value` when one exists, so a
 * `value`-carrying component can never emit. The ROOT emits `valueChange`
 * and deliberately has no `value` prop (`model` / `defaultValue` instead).
 */
import type { Define, JSXElement } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, useFieldContext } from '@sigx/zero/behaviors/core';
import type { FactoryBrands, JsxProps } from '@sigx/zero/contract/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies['toggle-group'];

type Orientation = 'horizontal' | 'vertical';

interface ToggleGroupContext {
    /** The pressed values, whatever the model's shape. */
    selected(): string[];
    multiple(): boolean;
    orientation(): Orientation;
    disabled(): boolean;
    toggle(value: string): void;
    /** Join the group's item order (mount order); returns the leave function. */
    register(id: number): () => void;
    /** Whether item `id` is at the join's start / end. */
    ends(id: number): JoinEnds;
}

/** An item's place at the ends of the join — both for an only item. */
export interface JoinEnds {
    first: boolean;
    last: boolean;
}

const makeInert = (): ToggleGroupContext => ({
    selected: () => [],
    multiple: () => false,
    orientation: () => 'horizontal',
    disabled: () => false,
    toggle: () => {},
    register: () => () => {},
    ends: () => ({ first: false, last: false }),
});

/** Item ids, unique across every group (only compared, never shown). */
let nextItemId = 0;

/**
 * Where `id` sits at the ends of `order` — the pure half of the root's
 * item tracking. An id not in the order is at neither end.
 */
export function toggleGroupEnds(order: readonly number[], id: number): JoinEnds {
    return { first: order.length > 0 && order[0] === id, last: order.length > 0 && order[order.length - 1] === id };
}

const useToggleGroupContext = defineInjectable<ToggleGroupContext>(makeInert);

/**
 * The pressed values of a model value under either shape — a string reads
 * as a one-element list (empty when `''`), an array is de-duplicated.
 */
export function toggleGroupSelection(value: string | string[] | null | undefined): string[] {
    if (Array.isArray(value)) return [...new Set(value)];
    return value ? [value] : [];
}

/**
 * The next model value after tapping `value` — zero's toggle rule: under
 * `multiple` the value flips in or out of the list; in single mode it
 * becomes THE value, and tapping the on item clears it (`''`) unless
 * `deselectable` is false.
 */
export function toggleGroupNext(
    current: readonly string[],
    value: string,
    options: { multiple: boolean; deselectable: boolean },
): string | string[] {
    const on = current.includes(value);
    if (options.multiple) return on ? current.filter((v) => v !== value) : [...current, value];
    if (on) return options.deselectable ? '' : value;
    return value;
}

// ── Root ──

/**
 * The props, generic over the model `M`: `string` in single mode, `string[]`
 * under `multiple` — the exported `ToggleGroup.Root` narrows it from
 * `multiple`.
 */
export type ToggleGroupRootProps<M = string | string[]> =
    & Define.Model<M>
    & Define.Prop<'defaultValue', M, false>
    & Define.Event<'valueChange', M>
    /** Allow more than one item on at a time (default false). */
    & Define.Prop<'multiple', boolean, false>
    /** In single mode, tapping the on item turns it off (default true). */
    & Define.Prop<'deselectable', boolean, false>
    & Define.Prop<'orientation', Orientation, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const ToggleGroupRootImpl = component<ToggleGroupRootProps>(({ props, slots, emit }) => {
    const seed = (): string | string[] => (props.defaultValue !== undefined ? props.defaultValue : props.multiple ? [] : '');
    const state = createControllableState<string | string[]>(
        () => props.model,
        seed(),
        (value) => emit('valueChange', value),
    );
    const field = useFieldContext();
    const disabled = () => !!props.disabled || field.disabled();
    const invalid = () => !!props.invalid || field.invalid();
    const required = () => !!props.required || field.required();
    const orientation = (): Orientation => props.orientation ?? 'horizontal';
    const selected = (): string[] => toggleGroupSelection(state.value);
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size ?? field.size(),
    }));
    // The items in mount order, replaced (never mutated) so a join or a
    // leave re-renders the end items.
    const items = signal({ order: [] as number[] });

    const ctx: ToggleGroupContext = {
        selected,
        multiple: () => !!props.multiple,
        orientation,
        disabled,
        toggle: (value) => {
            if (disabled()) return;
            state.value = toggleGroupNext(selected(), value, {
                multiple: !!props.multiple,
                deselectable: props.deselectable ?? true,
            });
        },
        register: (id) => {
            items.order = [...items.order, id];
            return () => {
                items.order = items.order.filter((other) => other !== id);
            };
        },
        ends: (id) => toggleGroupEnds(items.order, id),
    };
    defineProvide(useToggleGroupContext, () => ctx);

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: disabled(), invalid: invalid(), required: required() },
                orientation: orientation(),
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'ToggleGroup.Root' });

/** The exported root: the model's shape follows `multiple`. */
export type ToggleGroupRoot = {
    (props: JsxProps<ToggleGroupRootProps<string>> & { multiple?: false }): JSXElement;
    (props: JsxProps<ToggleGroupRootProps<string[]>> & { multiple: true }): JSXElement;
} & FactoryBrands;

const ToggleGroupRoot = ToggleGroupRootImpl as unknown as ToggleGroupRoot;

// ── Item ──

export type ToggleGroupItemProps =
    /** This item's value in the group's model. Non-empty in single mode (`''` means "none"). */
    & Define.Prop<'value', string, true>
    & Define.Prop<'disabled', boolean, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    /** Accessible name — required for icon-only items. */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const ToggleGroupItem = component<ToggleGroupItemProps>(({ props, slots, onUnmounted }) => {
    const group = useToggleGroupContext();
    const axes = useVariantAxes();
    // '' is the single-mode model's "nothing pressed": an item carrying it
    // could never read as on.
    if (props.value === '' && !group.multiple()) {
        throw new Error('[@sigx/lynx-zero] ToggleGroup: an item valued "" is reserved for "nothing pressed" in single mode — give it a non-empty value');
    }
    const disabled = (): boolean => !!props.disabled || group.disabled();
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    const isOn = (): boolean => group.selected().includes(props.value);
    const id = ++nextItemId;
    onUnmounted(group.register(id));

    return () => {
        const ends = group.ends(id);
        const onAxes = partAxes(axes());
        return (
            <view
                {...partBag(anatomy, 'item', {
                    state: isOn() ? 'on' : 'off',
                    flags: { disabled: disabled(), selected: isOn(), pressed: press.pressed() },
                    orientation: group.orientation(),
                    ...onAxes,
                    mods: { ...onAxes.mods, first: ends.first, last: ends.last },
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label, selected: isOn(), disabled: disabled() })}
                bindtap={() => {
                    if (!disabled()) group.toggle(props.value);
                }}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'ToggleGroup.Item' });

export const ToggleGroup = compound(ToggleGroupRoot, {
    Root: ToggleGroupRoot,
    Item: ToggleGroupItem,
});
