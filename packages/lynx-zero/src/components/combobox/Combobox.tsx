/**
 * Combobox — zero's editable combobox on lynx (#1278, zero wave 5): the
 * native `<input>` over an anchored, filtered listbox. It is Select's
 * portalled popup and Input's native text field in one root.
 *
 * ```tsx
 * <Combobox.Root items={countries} itemValue={(c) => c.code} itemLabel={(c) => c.name}
 *     model={() => state.country} model:inputValue={() => state.query}
 *     placeholder="Search countries…" emptyText="No match" clearable />
 *
 * // Tags: a chip per chosen value, before the field.
 * <Combobox.Root items={fruits} multiple model={() => state.fruits} />
 * ```
 *
 * Data mode only, like Select: the item list IS data on this platform, and
 * the popup renders in the overlay outlet, where data travels better than
 * slots. zero's hand-written `Combobox.Item` children have no lynx
 * counterpart. The list filters as you type: a case-insensitive contains
 * match on the label (`filter` replaces it, `filter={false}` shows every
 * item — a server-filtered list). zero's listbox core does the filtering and
 * the selection, so the rules are the web's rules.
 *
 * THE THREE MODELS (zero's named-models convention): `model` is the value
 * (`T | null`, `V | null` with `itemValue`, an array under `multiple`),
 * `model:inputValue` the text, `model:open` the popup.
 *
 * What the lynx projection keeps:
 * - Typing opens the list and filters it. A tap on an option picks it: in
 *   single mode the text becomes its label, the list closes and the soft
 *   keyboard goes down; under `multiple` the option toggles, the text clears
 *   and the list stays open.
 * - The keyboard's Enter key (lynx `bindconfirm`) commits the highlighted
 *   option. Only `autoHighlight` highlights (the first match while there is
 *   a query) — there are no arrow keys. With `allowCustom`, Enter with no
 *   highlight commits the text itself.
 * - A close resyncs the text (zero #265): in single mode empty text clears
 *   the value, other text reverts to the value's label (`allowCustom`
 *   commits it instead); under `multiple` the query is dropped.
 * - The trigger toggles the list WITHOUT focusing the field, so the whole
 *   list can be browsed with the keyboard down. `openOnClick` opens it when
 *   the field takes focus.
 * - The list is flipped above the field when the soft keyboard would cover
 *   it (`avoidKeyboard` on the anchor position). Inside a Dialog, the
 *   dialog's own keyboard lift moves the field and the ancestor-motion bump
 *   re-measures it.
 * - A tap on the field while the list is open lands on the list's
 *   light-dismiss surface, which covers the window. That tap does not
 *   dismiss: it focuses the field.
 *
 * Omitted parts: `hidden-input` (no forms on lynx), `spacer` and
 * `group-heading` (zero's windowed list only). The anatomy oracle walks
 * RENDERED parts, so omission is legal, as in Select. Web-only behaviour
 * that stays web-only: arrow-key highlight, Home/End, the tag keyboard
 * (#411), Escape, trigger mode (`@`-mentions), inline completion and
 * windowing (`virtual`). `focus-visible` on a tag or tag-remove is
 * reachable only through `ForceStates` — there is no keyboard to put focus
 * on them.
 */
import type { Define, JSXElement } from '@sigx/lynx';
import { component, compound, effect, onUnmounted, signal, untrack } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { Collection } from '@sigx/zero/behaviors/core';
import {
    createCollection, createControllableState, createFormControl, createListboxCore, namedModel, segmentBy,
} from '@sigx/zero/behaviors/core';
import type { FactoryBrands, JsxProps } from '@sigx/zero/contract/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { dismissTopLayer, registerDismissLayer } from '../../behaviors/dismiss.js';
import type { LynxPlacement } from '../../behaviors/position.js';
import { createAnchorPosition, useOutletFill } from '../../behaviors/position.js';
import { OVERLAY_ROOT_STYLE, useOverlayPortal } from '../../overlay/OverlayHost.js';
import type { EnterKeyHint, InvokableElement } from '../../shared/native-text.js';
import { blurNative, focusNative, nativeTextAttrs } from '../../shared/native-text.js';

const anatomy = anatomies.combobox;

/**
 * The list's block flow, spelled for lynx: a bare `<view>` is `display:
 * linear`, where rows and the separator shrink to their content (#1167).
 */
const LIST_FLOW = { display: 'flex', flexDirection: 'column' } as const;

/**
 * The control and a tag are `inline-flex` ROWS on the web. The lynx emitter
 * rewrites `inline-flex` to `flex` and keeps no direction, so the row is
 * stated here. Structural, not skin: every design system's field is a row.
 */
const ROW_FLOW = { display: 'flex', flexDirection: 'row' } as const;

/** A tap's point, in viewport coordinates when the payload carries them. */
interface TapLike {
    detail?: { x?: number; y?: number };
    touches?: ReadonlyArray<{ clientX?: number; clientY?: number; pageX?: number; pageY?: number; x?: number; y?: number }>;
    changedTouches?: ReadonlyArray<{ clientX?: number; clientY?: number; pageX?: number; pageY?: number; x?: number; y?: number }>;
}

/** Where a tap landed, or null when the payload does not say. Pure. @internal */
export function tapPoint(e: TapLike | undefined): { x: number; y: number } | null {
    const t = e?.changedTouches?.[0] ?? e?.touches?.[0];
    const x = t?.clientX ?? t?.pageX ?? t?.x ?? e?.detail?.x;
    const y = t?.clientY ?? t?.pageY ?? t?.y ?? e?.detail?.y;
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
}

/** Whether a point falls inside a measured rect (1px rounding slack). Pure. @internal */
export function pointInRect(p: { x: number; y: number }, r: { top: number; left: number; width: number; height: number }): boolean {
    return p.x >= r.left - 1 && p.x <= r.left + r.width + 1 && p.y >= r.top - 1 && p.y <= r.top + r.height + 1;
}

// ── Item ──

type ComboboxItemProps =
    & Define.Prop<'label', string, true>
    & Define.Prop<'selected', boolean, true>
    & Define.Prop<'highlighted', boolean, true>
    & Define.Prop<'disabled', boolean, true>
    & Define.Prop<'axes', VariantAxes, true>
    & Define.Prop<'onSelect', () => void, true>
    /** The root's `item` slot, already bound to this item — replaces the label text. */
    & Define.Prop<'content', (() => JSXElement | JSXElement[]) | undefined, false>;

/** One option row — a real component so each row owns its press feedback. */
const ComboboxItem = component<ComboboxItemProps>(({ props }) => {
    const press = createPressFeedback({ isDisabled: () => props.disabled });
    return () => (
        <view
            {...partBag(anatomy, 'item', {
                flags: {
                    selected: props.selected,
                    highlighted: props.highlighted,
                    disabled: props.disabled,
                    pressed: press.pressed(),
                },
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
                ? <text {...partBag(anatomy, 'item-indicator', { flags: { selected: true }, ...partAxes(props.axes) })}>✓</text>
                : null}
        </view>
    );
}, { name: 'Combobox.Item' });

// ── Tag ──

/** What a tag's content slot receives: the key, its label, and the data item (absent for a custom value). */
export interface ComboboxTagSlotProps<T = unknown> {
    value: string;
    label: string;
    item: T | undefined;
}

type ComboboxTagProps =
    & Define.Prop<'label', string, true>
    & Define.Prop<'disabled', boolean, true>
    /** Disabled or readonly: the remove button does nothing. */
    & Define.Prop<'inert', boolean, true>
    & Define.Prop<'axes', VariantAxes, true>
    & Define.Prop<'onRemove', () => void, true>
    & Define.Prop<'content', (() => JSXElement | JSXElement[]) | undefined, false>;

/** One chosen value under `multiple`: its label and a remove button, each with its own press. */
const ComboboxTag = component<ComboboxTagProps>(({ props }) => {
    const press = createPressFeedback({ isDisabled: () => props.inert });
    return () => (
        <view
            {...partBag(anatomy, 'tag', { flags: { disabled: props.disabled }, ...partAxes(props.axes) })}
            style={{ ...ROW_FLOW, alignItems: 'center' }}
        >
            {props.content
                ? props.content()
                : [
                    <text key="l" {...partBag(anatomy, 'tag-label', { ...partAxes(props.axes) })}>{props.label}</text>,
                    <view
                        key="r"
                        {...partBag(anatomy, 'tag-remove', {
                            flags: { disabled: props.disabled, pressed: press.pressed() },
                            ...partAxes(props.axes),
                        })}
                        {...partA11y({ trait: 'button', label: `Remove ${props.label}`, disabled: props.disabled })}
                        // Caught: a remove never also lands on the control's focus tap.
                        catchtap={() => {
                            if (!props.inert) props.onRemove();
                        }}
                        {...press.handlers}
                    >
                        <text>×</text>
                    </view>,
                ]}
        </view>
    );
}, { name: 'Combobox.Tag' });

// ── Trigger ──

type ComboboxTriggerProps =
    & Define.Prop<'open', boolean, true>
    & Define.Prop<'disabled', boolean, true>
    /** Disabled or readonly: no toggle, no press. */
    & Define.Prop<'inert', boolean, true>
    & Define.Prop<'label', string, true>
    & Define.Prop<'axes', VariantAxes, true>
    & Define.Prop<'onToggle', () => void, true>;

/** The chevron: toggles the list, never the keyboard. */
const ComboboxTrigger = component<ComboboxTriggerProps>(({ props }) => {
    const press = createPressFeedback({ isDisabled: () => props.inert });
    return () => (
        <view
            {...partBag(anatomy, 'trigger', {
                state: props.open ? 'open' : 'closed',
                flags: { disabled: props.disabled, pressed: press.pressed() },
                ...partAxes(props.axes),
            })}
            {...partA11y({ trait: 'button', label: props.label, expanded: props.open, disabled: props.disabled })}
            catchtap={() => {
                if (!props.inert) props.onToggle();
            }}
            {...press.handlers}
        >
            <text>▾</text>
        </view>
    );
}, { name: 'Combobox.Trigger' });

// ── Root ──

/**
 * The props, generic over the item `T` and the model `M`. The exported
 * `Combobox.Root` narrows `M` from the props (see `ComboboxRoot`).
 */
export type ComboboxRootProps<T = unknown, M = unknown> =
    & Define.Model<M>
    /** Typed per overload on the exported root, as Select's is. */
    & Define.Prop<'defaultValue', unknown, false>
    & Define.Event<'valueChange', M>
    /** The text in the field, two-way (`model:inputValue`) — the query the list filters on. */
    & Define.Model<'inputValue', string>
    /** Initial text (uncontrolled). Default: the preset value's label in single mode, else empty. */
    & Define.Prop<'defaultInputValue', string, false>
    & Define.Event<'inputValueChange', string>
    /** The popup's open state, two-way (`model:open`). */
    & Define.Model<'open', boolean>
    /** Start with the list open (uncontrolled — a gallery renders it statically). */
    & Define.Prop<'defaultOpen', boolean, false>
    & Define.Event<'openChange', boolean>
    /** The items as data. */
    & Define.Prop<'items', ReadonlyArray<T>, true>
    /** String identity: the item's key (default: `value` / `id` / the primitive). */
    & Define.Prop<'itemKey', (item: T) => string, false>
    /** Display text, and what the filter matches (default: `label` / the key). */
    & Define.Prop<'itemLabel', (item: T) => string, false>
    & Define.Prop<'itemDisabled', (item: T) => boolean, false>
    /** Group heading; items sharing one render together, first-appearance order. */
    & Define.Prop<'itemGroup', (item: T) => string | undefined, false>
    /** What the model holds for an item (default: the item). Return a primitive. */
    & Define.Prop<'itemValue', (item: T) => unknown, false>
    /**
     * Visibility: the default is a case-insensitive contains-match on the
     * label; a function replaces it; `false` shows every item (a
     * server-filtered list). Read once, at setup.
     */
    & Define.Prop<'filter', false | ((item: T, query: string) => boolean), false>
    /** Shown in the list while nothing matches (and it is not `loading`). */
    & Define.Prop<'emptyText', string, false>
    /** The list is still arriving: the `loading` row renders and `emptyText` holds back. */
    & Define.Prop<'loading', boolean, false>
    /** The `loading` row's text (default "Loading…"). */
    & Define.Prop<'loadingText', string, false>
    /** Render a clear-trigger in the field while there is a value or text to clear. */
    & Define.Prop<'clearable', boolean, false>
    /** Accessible name of the clear-trigger (default "Clear"). */
    & Define.Prop<'clearLabel', string, false>
    /** Several values, shown as tags before the field. A pick toggles and keeps the list open. */
    & Define.Prop<'multiple', boolean, false>
    /**
     * Enter (the keyboard's confirm key) with no highlighted option commits
     * the text: the option whose label it matches, else the text itself as
     * the value — for string models. A close with text does the same.
     */
    & Define.Prop<'allowCustom', boolean, false>
    /** Typing highlights the first enabled match, so Enter picks it. Only while there is a query. */
    & Define.Prop<'autoHighlight', boolean, false>
    /** Open the list when the field takes focus (default: typing and the trigger open it). */
    & Define.Prop<'openOnClick', boolean, false>
    /** The field's placeholder text. */
    & Define.Prop<'placeholder', string, false>
    /** What the keyboard's Enter key says (lynx `confirm-type`). */
    & Define.Prop<'enterkeyhint', EnterKeyHint, false>
    /** Autocorrection (iOS). Off suits a lookup field; unset leaves the platform default. */
    & Define.Prop<'autocorrect', 'on' | 'off', false>
    & Define.Prop<'disabled', boolean, false>
    /** Announced, never edited or opened. The prop OR the Field's. */
    & Define.Prop<'readonly', boolean, false>
    & Define.Prop<'invalid', boolean, false>
    & Define.Prop<'required', boolean, false>
    /** Draw a `separator` rule between consecutive runs of options (groups). */
    & Define.Prop<'groupSeparators', boolean, false>
    & Define.Prop<'placement', LynxPlacement, false>
    & Define.Prop<'offset', number, false>
    /** Accessible name of the field (the visible label is separate). */
    & Define.Prop<'label', string, false>
    /** Accessible name of the trigger (default "Show options"). */
    & Define.Prop<'triggerLabel', string, false>
    & Define.Prop<'color', string, false>
    /** Falls back to the enclosing Field's size. */
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    /** Custom content for an option row (replaces the label text). */
    & Define.Slot<'item', { item: T }>
    /** Custom content for a tag under `multiple` (replaces the label + remove button). */
    & Define.Slot<'tag', ComboboxTagSlotProps<T>>;

interface InputEventLike {
    detail?: { value?: unknown };
}

const ComboboxRootImpl = component<ComboboxRootProps>(({ props, emit, slots }) => {
    const multiple = (): boolean => !!props.multiple;
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
        props.defaultValue ?? (props.multiple ? [] : null),
        (next) => emit('valueChange', next),
    );
    const open = createControllableState<boolean>(
        () => namedModel<boolean>(props.open),
        props.defaultOpen ?? false,
        (next) => emit('openChange', next),
    );
    const inputValue = createControllableState<string>(
        () => namedModel<string>(props.inputValue),
        props.defaultInputValue ?? '',
        (next) => emit('inputValueChange', next),
    );
    const fc = createFormControl({ props: () => props, idBase: 'zx-combobox', controlPart: 'input' });
    const disabled = (): boolean => fc.disabled();
    const readonly = (): boolean => fc.readonly();
    const inert = (): boolean => disabled() || readonly();
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size ?? fc.field.size(),
    }));
    const local = signal({ focused: false });
    let inputEl: InvokableElement | null = null;

    const listbox = createListboxCore<unknown>({
        collection,
        selection: value,
        multiple,
        idBase: 'zx-combobox',
        query: () => inputValue.value,
        filter: props.filter,
        emptyValue: null,
        onSelect: (key) => {
            // A multiple pick toggles, clears the query and stays open; a
            // single one fills the text, closes, and puts the keyboard away.
            if (multiple()) {
                inputValue.value = '';
                return;
            }
            inputValue.value = collection.label(key);
            open.value = false;
            blurNative(inputEl);
        },
    });

    /** The single mode's chosen key — `null` while nothing is chosen. */
    const singleKey = (): string | null => (multiple() ? null : listbox.selectedKeys()[0] ?? null);
    // A preset value's label reaches the field before anything is typed.
    if (!multiple() && props.defaultInputValue === undefined && inputValue.value === '') {
        const key = singleKey();
        if (key !== null) inputValue.value = collection.label(key);
    }
    // A value written from outside (the consumer's model) moves the text too.
    let lastKey = singleKey();
    effect(() => {
        const key = singleKey();
        if (key === lastKey) return;
        lastKey = key;
        untrack(() => {
            const label = key === null ? '' : collection.label(key);
            if (!open.value && inputValue.value !== label) inputValue.value = label;
        });
    });

    /** Commit free text (`allowCustom`): the option whose label it is, else the text itself. */
    const commitText = (text: string): void => {
        const match = listbox.visibleKeys().find((k) => collection.label(k).toLowerCase() === text.toLowerCase());
        if (match !== undefined) {
            listbox.select(match);
            return;
        }
        if (multiple()) {
            const current = Array.isArray(value.value) ? value.value : [];
            if (!listbox.isSelected(text)) value.value = [...current, text];
            inputValue.value = '';
            return;
        }
        value.value = text;
        inputValue.value = text;
        open.value = false;
    };

    /**
     * Resync the text with the value (zero #265) — on every close, and on a
     * blur while closed: single mode, empty text clears the value and other
     * text reverts to the value's label (`allowCustom` commits it instead);
     * multiple mode drops the query.
     */
    const commitInputText = (): void => {
        if (inert()) return;
        const text = inputValue.value;
        if (multiple()) {
            if (text !== '') inputValue.value = '';
            return;
        }
        const key = singleKey();
        if (text.trim() === '') {
            if (key !== null) listbox.clear();
            if (inputValue.value !== '') inputValue.value = '';
            return;
        }
        if (props.allowCustom) {
            const display = key === null ? '' : collection.label(key);
            if (text.trim() !== display) commitText(text.trim());
            return;
        }
        const display = key === null ? '' : collection.label(key);
        if (text !== display) inputValue.value = display;
    };

    // A close clears the highlight and resyncs the text, however the open
    // state was written (a consumer's `model:open` included).
    let wasOpen = open.value;
    effect(() => {
        const now = open.value;
        if (now === wasOpen) return;
        wasOpen = now;
        if (now) return;
        untrack(() => {
            listbox.highlighted.value = null;
            commitInputText();
        });
    });

    // `autoHighlight`: the first enabled match while there is a query, moved
    // on whenever the query changes. Nothing visible → no highlight, so
    // `allowCustom`'s Enter commits the text.
    let lastQuery: string | null = null;
    effect(() => {
        if (!props.autoHighlight) return;
        const isOpen = open.value;
        const query = inputValue.value;
        const visible = listbox.visibleKeys();
        const h = listbox.highlighted.value;
        if (!isOpen || query.trim() === '') {
            lastQuery = null;
            if (h !== null) untrack(() => { listbox.highlighted.value = null; });
            return;
        }
        if (query !== lastQuery || h === null || !visible.includes(h) || collection.isDisabled(h)) {
            lastQuery = query;
            untrack(() => listbox.move('first'));
        }
    });

    const setOpen = (next: boolean): void => {
        if (next && inert()) return;
        if (open.value !== next) open.value = next;
    };
    const focusInput = (): void => {
        if (!disabled()) focusNative(inputEl);
    };
    const onType = (text: string): void => {
        if (inert()) return;
        // Android's native <input> fires `input` for PROGRAMMATIC writes too
        // (#1298): the preset value's label at mount, the picked option's
        // label after a pick. Those events report exactly the text the model
        // already holds, and typing always changes the text — so an event
        // that changes nothing is an echo, not typing, and must not open the
        // list (iOS and the web never send it).
        if (text === inputValue.value) return;
        inputValue.value = text;
        setOpen(true);
    };
    const onConfirm = (): void => {
        if (inert()) return;
        const h = listbox.highlighted.value;
        if (open.value && h !== null && listbox.isVisible(h) && !collection.isDisabled(h)) {
            listbox.select(h);
            return;
        }
        const text = inputValue.value.trim();
        if (props.allowCustom && text !== '') commitText(text);
    };
    const remove = (key: string): void => {
        if (inert()) return;
        const current = Array.isArray(value.value) ? value.value : [];
        value.value = current.filter((v) => collection.keyForValue(v) !== key);
    };
    const clearable = (): boolean => !!props.clearable && !inert()
        && (inputValue.value !== '' || listbox.selectedKeys().length > 0);
    const clear = (): void => {
        if (inert()) return;
        listbox.clear();
        inputValue.value = '';
        focusInput();
    };
    /** No typed text and nothing chosen — the root's and control's `placeholder`. */
    const empty = (): boolean => inputValue.value === '' && listbox.selectedKeys().length === 0;
    const state = (): 'open' | 'closed' => (open.value ? 'open' : 'closed');

    // The Field's label focuses the field (zero#284's seam).
    fc.reportValidity({ element: () => null, value: () => (multiple() ? '' : inputValue.value), focus: focusInput }, onUnmounted);

    const position = createAnchorPosition({
        placement: props.placement ?? 'bottom-start',
        offset: props.offset,
        isOpen: () => open.value,
        avoidKeyboard: true,
    });
    const portal = useOverlayPortal();
    const fill = useOutletFill();

    const itemRow = (item: unknown, key: string): JSXElement => {
        const k = collection.keyOf(item);
        return (
            <ComboboxItem
                key={key}
                label={collection.labelOf(item)}
                selected={listbox.isSelected(k)}
                highlighted={listbox.highlighted.value === k}
                disabled={collection.isItemDisabled(item)}
                axes={axes()}
                onSelect={() => {
                    // A readonly combobox's option is inert.
                    if (!inert()) listbox.select(k);
                }}
                content={slots.item ? () => slots.item!({ item }) : undefined}
            />
        );
    };

    /** The list's rows: loading, empty, then the visible options by group. */
    const listRows = (): JSXElement[] => {
        const rows: JSXElement[] = [];
        const loading = !!props.loading;
        if (loading) {
            rows.push(
                <text key="loading" {...partBag(anatomy, 'loading', { ...partAxes(axes()) })}>
                    {props.loadingText ?? 'Loading…'}
                </text>,
            );
        }
        const visible = listbox.visibleItems();
        if (visible.length === 0 && !loading && props.emptyText !== undefined) {
            rows.push(<text key="empty" {...partBag(anatomy, 'empty', { ...partAxes(axes()) })}>{props.emptyText}</text>);
        }
        segmentBy(visible, (item) => collection.groupOf(item)).forEach((segment, index) => {
            if (props.groupSeparators && index > 0) {
                rows.push(<view key={`s-${index}`} {...partBag(anatomy, 'separator', { ...partAxes(axes()) })} />);
            }
            if (segment.group !== undefined) {
                rows.push(
                    <view key={`g-${segment.group}`} {...partBag(anatomy, 'group', { ...partAxes(axes()) })} style={LIST_FLOW}>
                        <text {...partBag(anatomy, 'group-label', { ...partAxes(axes()) })}>{segment.group}</text>
                        {segment.items.map((item) => itemRow(item, collection.keyOf(item)))}
                    </view>,
                );
            } else {
                for (const item of segment.items) rows.push(itemRow(item, `u-${index}-${collection.keyOf(item)}`));
            }
        });
        return rows;
    };

    /** A tap on the dismiss surface: over the field it focuses the field, anywhere else it dismisses. */
    const surfaceTap = (e: TapLike): void => {
        const point = tapPoint(e);
        const anchor = position.anchorRect();
        if (point && anchor && pointInRect(point, anchor)) {
            focusInput();
            return;
        }
        dismissTopLayer();
    };

    /** Whether an open list has anything to show: options, the empty text, or the loading row. */
    const hasRows = (): boolean => !!props.loading || props.emptyText !== undefined || listbox.visibleItems().length > 0;

    let unregister: (() => void) | null = null;
    effect(() => {
        if (open.value) {
            unregister ??= registerDismissLayer({
                dismiss: () => {
                    open.value = false;
                },
            });
        } else {
            unregister?.();
            unregister = null;
        }
        // An open list with nothing to show (no match, no `emptyText`, not
        // loading) paints no empty panel — the field stays `open`, and the
        // panel appears as soon as there is something to show.
        if (open.value && hasRows()) {
            portal.show(() => {
                const anchor = position.anchorRect();
                return (
                    // A 0×0 root (see Popover): it covers nothing natively, so
                    // a pan beside the list scrolls the page (#1190); it opts
                    // back into lynx touches under the pass-through layer (#1180).
                    <view style={{ ...OVERLAY_ROOT_STYLE, position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible' }}>
                        <view
                            // Transparent outside surface — light dismiss
                            // through the stack, so a combobox inside a dialog
                            // closes before it. Out of native hit-testing:
                            // taps dismiss, pans pass through.
                            native-interaction-enabled={false}
                            style={fill()}
                            bindtap={surfaceTap}
                            bindtouchstart={position.track}
                            bindtouchmove={position.track}
                            bindtouchend={position.track}
                            bindtouchcancel={position.track}
                        />
                        <view
                            {...partBag(anatomy, 'popup', {
                                state: 'open',
                                placement: position.position()?.placement ?? props.placement ?? 'bottom-start',
                                ...partAxes(axes()),
                            })}
                            {...(props.loading ? { 'accessibility-status': 'busy' } : {})}
                            // The web's `min-width: var(--anchor-width)`: the
                            // list is at least as wide as the field.
                            style={{
                                ...LIST_FLOW,
                                ...(anchor && anchor.width > 0 ? { minWidth: `${anchor.width}px` } : {}),
                                ...position.style(),
                            }}
                            main-thread:ref={position.floatingRef}
                            bindlayoutchange={position.floatingLayoutChange}
                            catchtap={() => {}}
                        >
                            {listRows()}
                        </view>
                    </view>
                );
            });
        } else {
            portal.hide();
        }
    });
    onUnmounted(() => unregister?.());

    const tagRow = (key: string): JSXElement => {
        const label = collection.label(key);
        const item = collection.byKey(key);
        return (
            <ComboboxTag
                key={`t-${key}`}
                label={label}
                disabled={disabled()}
                inert={inert()}
                axes={axes()}
                onRemove={() => remove(key)}
                content={slots.tag ? () => slots.tag!({ value: key, label, item }) : undefined}
            />
        );
    };

    const handlers: Record<string, unknown> = {
        bindinput: (e: InputEventLike) => {
            const v = e?.detail?.value;
            onType(v == null ? '' : String(v));
        },
        bindfocus: () => {
            local.focused = true;
            if (props.openOnClick) setOpen(true);
        },
        bindblur: () => {
            local.focused = false;
            // Open, the blur may be a tap on an option on its way: the close
            // resyncs instead.
            if (!open.value) commitInputText();
        },
        bindconfirm: () => onConfirm(),
    };

    return () => {
        const flags = { disabled: disabled(), invalid: fc.invalid(), required: fc.required(), readonly: readonly() };
        const native: Record<string, unknown> = {
            ...nativeTextAttrs({
                placeholder: props.placeholder,
                enterkeyhint: props.enterkeyhint,
                autocorrect: props.autocorrect,
                disabled: disabled(),
                readonly: readonly(),
            }),
            type: 'text',
            value: inputValue.value,
        };
        if (props.label !== undefined) native['accessibility-label'] = props.label;
        return (
            <view
                {...partBag(anatomy, 'root', {
                    flags: { ...flags, placeholder: empty() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
            >
                <view
                    {...partBag(anatomy, 'control', {
                        state: state(),
                        flags: {
                            disabled: disabled(),
                            invalid: fc.invalid(),
                            'focus-visible': local.focused,
                            placeholder: empty(),
                        },
                        ...partAxes(axes()),
                    })}
                    style={ROW_FLOW}
                    // The box's padding and a tag's body focus the field.
                    bindtap={focusInput}
                    main-thread:ref={position.anchorRef}
                    bindlayoutchange={position.anchorLayoutChange}
                >
                    {multiple() ? listbox.selectedKeys().map(tagRow) : null}
                    <input
                        {...partBag(anatomy, 'input', {
                            state: state(),
                            flags: { ...flags, 'focus-visible': local.focused },
                            ...partAxes(axes()),
                        })}
                        {...native}
                        {...handlers}
                        ref={(el: unknown) => {
                            inputEl = el as InvokableElement | null;
                        }}
                    />
                    {clearable()
                        ? (
                            <view
                                // The anatomy gives this part no pressed flag
                                // (zero's web part has none either) — its
                                // feedback is the text leaving.
                                {...partBag(anatomy, 'clear-trigger', { ...partAxes(axes()) })}
                                {...partA11y({ trait: 'button', label: props.clearLabel ?? 'Clear' })}
                                catchtap={clear}
                            >
                                <text>×</text>
                            </view>
                        )
                        : null}
                    <ComboboxTrigger
                        open={open.value}
                        disabled={disabled()}
                        inert={inert()}
                        label={props.triggerLabel ?? 'Show options'}
                        axes={axes()}
                        onToggle={() => setOpen(!open.value)}
                    />
                </view>
            </view>
        );
    };
}, { name: 'Combobox.Root' });

/**
 * The generic root: `T` infers from `items`; the model is `T | null` unless
 * `itemValue` returns `V`, then `V | null` — and an array of either under
 * `multiple`.
 */
export type ComboboxRoot = {
    <T>(props: JsxProps<ComboboxRootProps<T, T[]>> & {
        items: ReadonlyArray<T>;
        multiple: true;
        defaultValue?: T[];
        itemValue?: undefined;
    }): JSXElement;
    <T, V>(props: JsxProps<ComboboxRootProps<T, V[]>> & {
        items: ReadonlyArray<T>;
        multiple: true;
        defaultValue?: V[];
        itemValue: (item: T) => V;
    }): JSXElement;
    <T>(props: JsxProps<ComboboxRootProps<T, T | null>> & {
        items: ReadonlyArray<T>;
        multiple?: false;
        defaultValue?: T | null;
        itemValue?: undefined;
    }): JSXElement;
    <T, V>(props: JsxProps<ComboboxRootProps<T, V | null>> & {
        items: ReadonlyArray<T>;
        multiple?: false;
        defaultValue?: V | null;
        itemValue: (item: T) => V;
    }): JSXElement;
} & FactoryBrands;

const ComboboxRoot = ComboboxRootImpl as unknown as ComboboxRoot;

export const Combobox = compound(ComboboxRoot, { Root: ComboboxRoot });
