/**
 * Select — the integration stressor of the pilot: items + overlay + list +
 * anchored positioning in one component. Data-driven over zero's collection
 * core (`createCollection`, zero 0.3 — the `options` sugar and
 * `segmentOptions` are gone upstream), because on a touch platform the item
 * list IS data — there is no keyboard navigation or typeahead to hang off
 * child composition, and the popup renders in the overlay outlet where data
 * props travel better than slots. Data mode only: zero's JSX-item mode
 * (`Select.Item` children) has no lynx counterpart.
 *
 * Generic at the JSX level the way zero's root is (`contract/generic`): the
 * implementation is written against `unknown` and exported through a cast to
 * overloaded call signatures, so `<Select.Root items={fruits} …>` infers `T`
 * from `items`, the model is `T | null` — or `V | null` when `itemValue`
 * says what the model holds — and `onValueChange` is typed from it.
 *
 * The popup's JSX lives in this component's own closures, so context flows
 * lexically — no PortalScope needed. The one portal-hostile piece is press
 * feedback, which must be PER ITEM (a shared instance would light every
 * item at once — the Toast review scar), so each item renders through an
 * internal component that owns its own pressed signal.
 *
 * `hidden-input` is omitted: no forms on lynx, and the anatomy oracle walks
 * RENDERED parts, so omission is legal — same call as Switch.
 */
import type { Define, JSXElement } from '@sigx/lynx';
import { component, compound, effect, onUnmounted } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { Collection } from '@sigx/zero/behaviors/core';
import { createCollection, createControllableState, useFieldContext } from '@sigx/zero/behaviors/core';
import type { FactoryBrands, JsxProps } from '@sigx/zero/contract/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { dismissTopLayer, registerDismissLayer } from '../../behaviors/dismiss.js';
import type { LynxPlacement } from '../../behaviors/position.js';
import { createAnchorPosition } from '../../behaviors/position.js';
import { useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.select;

type SelectItemProps =
    & Define.Prop<'label', string, true>
    & Define.Prop<'selected', boolean, true>
    & Define.Prop<'disabled', boolean, true>
    & Define.Prop<'axes', VariantAxes, true>
    & Define.Prop<'onSelect', () => void, true>
    /** The root's `item` slot, already bound to this item — replaces the label text. */
    & Define.Prop<'content', (() => JSXElement | JSXElement[]) | undefined, false>;

/** One item row — a real component so each row owns its press feedback. */
const SelectItem = component<SelectItemProps>(({ props }) => {
    const press = createPressFeedback({ isDisabled: () => props.disabled });
    return () => (
        <view
            {...partBag(anatomy, 'item', {
                flags: { selected: props.selected, disabled: props.disabled, pressed: press.pressed() },
                ...partAxes(props.axes),
            })}
            {...partA11y({ trait: 'button', label: props.label, selected: props.selected, disabled: props.disabled })}
            bindtap={() => {
                if (!props.disabled) props.onSelect();
            }}
            {...press.handlers}
        >
            {props.content ? props.content() : <text>{props.label}</text>}
            {props.selected
                ? <view {...partBag(anatomy, 'item-indicator', { flags: { selected: true }, ...partAxes(props.axes) })} />
                : null}
        </view>
    );
}, { name: 'Select.Item' });

/**
 * The props, generic over the item `T` and the model `M`. The exported
 * `Select.Root` narrows `M` from the props (see `SelectRoot`): `T | null`,
 * or `V | null` when `itemValue` returns `V`.
 */
export type SelectRootProps<T = unknown, M = unknown> =
    & Define.Model<M>
    /**
     * Typed per overload on the exported root (`T | null` / `V | null`), as
     * zero's Select does: declared here as `M`, TypeScript stops inferring
     * `T` for the `itemValue` overload.
     */
    & Define.Prop<'defaultValue', unknown, false>
    & Define.Event<'valueChange', M>
    /** The items as data — the list IS data on this platform. */
    & Define.Prop<'items', ReadonlyArray<T>, true>
    /** String identity: the item's key (default: `value` / `id` / the primitive). */
    & Define.Prop<'itemKey', (item: T) => string, false>
    /** Display text (default: `label` / the key). */
    & Define.Prop<'itemLabel', (item: T) => string, false>
    & Define.Prop<'itemDisabled', (item: T) => boolean, false>
    /** Group heading; items sharing one render together, first-appearance order. */
    & Define.Prop<'itemGroup', (item: T) => string | undefined, false>
    /** What the model holds for an item (default: the item). Return a primitive. */
    & Define.Prop<'itemValue', (item: T) => unknown, false>
    /** Shown in the value part while nothing is selected. */
    & Define.Prop<'placeholder', string, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    & Define.Prop<'placement', LynxPlacement, false>
    & Define.Prop<'offset', number, false>
    /** Accessible name for the trigger (the value text alone is ambiguous). */
    & Define.Prop<'label', string, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Prop<'class', string, false>
    /** Custom content for a generated item row (replaces the label text). */
    & Define.Slot<'item', { item: T }>;

const SelectRootImpl = component<SelectRootProps>(({ props, emit, slots }) => {
    // The accessors are read once: they name the shape of `items`, which does
    // not change across renders; `items` itself is read reactively.
    const collection: Collection<unknown, unknown> = createCollection<unknown, unknown>({
        items: () => props.items,
        itemKey: props.itemKey,
        itemLabel: props.itemLabel,
        itemDisabled: props.itemDisabled,
        itemGroup: props.itemGroup,
        itemValue: props.itemValue,
    });
    const value = createControllableState<unknown>(
        () => props.model,
        props.defaultValue ?? null,
        (next) => emit('valueChange', next),
    );
    // Open state is component-internal: nothing outside a select ever drives
    // its popup, and light dismiss goes through the layer stack anyway.
    const open = createControllableState<boolean>(() => undefined, false, () => {});
    const field = useFieldContext();
    const disabled = () => !!props.disabled || field.disabled();
    const invalid = () => !!props.invalid || field.invalid();
    const axes = (): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size, variant: props.variant });
    provideVariantAxes(axes);
    const press = createPressFeedback({ isDisabled: disabled });
    const position = createAnchorPosition({
        placement: props.placement ?? 'bottom-start',
        offset: props.offset,
    });
    const portal = useOverlayPortal();

    /** The selected item's key — `null` while nothing is selected. */
    const selectedKey = (): string | null => (value.value == null ? null : collection.keyForValue(value.value));
    const selected = (): unknown => (value.value == null ? undefined : collection.byValue(value.value));
    const triggerState = () => (open.value ? 'open' : 'closed');
    const pick = (item: unknown): void => {
        value.value = collection.valueOf(item);
        open.value = false;
    };
    const itemRow = (item: unknown, key: string): JSXElement => (
        <SelectItem
            key={key}
            label={collection.labelOf(item)}
            selected={collection.keyOf(item) === selectedKey()}
            disabled={collection.isItemDisabled(item)}
            axes={axes()}
            onSelect={() => pick(item)}
            content={slots.item ? () => slots.item!({ item }) : undefined}
        />
    );

    let unregister: (() => void) | null = null;
    effect(() => {
        if (open.value) {
            unregister ??= registerDismissLayer({
                dismiss: () => {
                    open.value = false;
                },
            });
            portal.show(() => (
                <view
                    // Transparent outside surface — light dismiss through the
                    // stack, so a select inside a dialog closes before it.
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                    bindtap={() => dismissTopLayer()}
                >
                    <view
                        {...partBag(anatomy, 'popup', {
                            state: 'open',
                            placement: position.position()?.placement ?? props.placement ?? 'bottom-start',
                            ...partAxes(axes()),
                        })}
                        style={position.style()}
                        main-thread:ref={position.floatingRef}
                        bindlayoutchange={position.floatingLayoutChange}
                        catchtap={() => {}}
                    >
                        {collection.segments().map((segment, index) =>
                            segment.group !== undefined
                                ? (
                                    <view key={`g-${segment.group}`} {...partBag(anatomy, 'group', { ...partAxes(axes()) })}>
                                        <text {...partBag(anatomy, 'group-label', { ...partAxes(axes()) })}>
                                            {segment.group}
                                        </text>
                                        {segment.items.map((item) => itemRow(item, collection.keyOf(item)))}
                                    </view>
                                )
                                : segment.items.map((item) => itemRow(item, `u-${index}-${collection.keyOf(item)}`)))}
                    </view>
                </view>
            ));
        } else {
            unregister?.();
            unregister = null;
            portal.hide();
        }
    });
    onUnmounted(() => unregister?.());

    return () => (
        <view
            {...partBag(anatomy, 'root', {
                flags: { disabled: disabled(), invalid: invalid(), required: props.required },
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            <view
                {...partBag(anatomy, 'trigger', {
                    state: triggerState(),
                    flags: {
                        disabled: disabled(),
                        invalid: invalid(),
                        placeholder: selected() === undefined,
                        pressed: press.pressed(),
                    },
                    ...partAxes(axes()),
                })}
                {...partA11y({ trait: 'button', label: props.label, disabled: disabled() })}
                bindtap={() => {
                    if (!disabled()) open.value = !open.value;
                }}
                main-thread:ref={position.anchorRef}
                bindlayoutchange={position.anchorLayoutChange}
                {...press.handlers}
            >
                <text {...partBag(anatomy, 'value', { flags: { placeholder: selected() === undefined }, ...partAxes(axes()) })}>
                    {(() => {
                        const current = selected();
                        return current !== undefined ? collection.labelOf(current) : props.placeholder ?? '';
                    })()}
                </text>
                <view {...partBag(anatomy, 'indicator', { state: triggerState(), ...partAxes(axes()) })} />
            </view>
        </view>
    );
}, { name: 'Select.Root' });

/**
 * The generic root: `T` infers from `items`; the model is `T | null` unless
 * `itemValue` returns `V`, then `V | null`.
 */
export type SelectRoot = {
    <T>(props: JsxProps<SelectRootProps<T, T | null>> & {
        items: ReadonlyArray<T>;
        defaultValue?: T | null;
        itemValue?: undefined;
    }): JSXElement;
    <T, V>(props: JsxProps<SelectRootProps<T, V | null>> & {
        items: ReadonlyArray<T>;
        defaultValue?: V | null;
        itemValue: (item: T) => V;
    }): JSXElement;
} & FactoryBrands;

const SelectRoot = SelectRootImpl as unknown as SelectRoot;

export const Select = compound(SelectRoot, { Root: SelectRoot });
