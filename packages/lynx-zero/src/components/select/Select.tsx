/**
 * Select — the integration stressor of the pilot: options + overlay + list
 * + anchored positioning in one component. Options-driven like zero's sugar
 * Select (`segmentOptions` groups them), because on a touch platform the
 * item list IS data — there is no keyboard navigation or typeahead to hang
 * off child composition, and the popup renders in the overlay outlet where
 * data props travel better than slots.
 *
 * The popup's JSX lives in this component's own closures, so context flows
 * lexically — no PortalScope needed. The one portal-hostile piece is press
 * feedback, which must be PER ITEM (a shared instance would light every
 * item at once — the Toast review scar), so each option renders through an
 * internal component that owns its own pressed signal.
 *
 * `hidden-input` is omitted: no forms on lynx, and the anatomy oracle walks
 * RENDERED parts, so omission is legal — same call as Switch.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, effect, onUnmounted } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { OptionInput } from '@sigx/zero/behaviors/core';
import { createControllableState, segmentOptions, useFieldContext } from '@sigx/zero/behaviors/core';
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

/** Zero's own option shape — `label` defaults to `value`, `group` groups. */
export type SelectOption = OptionInput;

const optionLabel = (option: SelectOption): string => option.label ?? option.value;

type SelectItemProps =
    & Define.Prop<'option', SelectOption, true>
    & Define.Prop<'selected', boolean, true>
    & Define.Prop<'axes', VariantAxes, true>
    & Define.Prop<'onSelect', () => void, true>;

/** One option row — a real component so each row owns its press feedback. */
const SelectItem = component<SelectItemProps>(({ props }) => {
    const disabled = () => !!props.option.disabled;
    const press = createPressFeedback({ isDisabled: disabled });
    return () => (
        <view
            {...partBag(anatomy, 'item', {
                flags: { selected: props.selected, disabled: disabled(), pressed: press.pressed() },
                ...partAxes(props.axes),
            })}
            {...partA11y({ trait: 'button', label: optionLabel(props.option), selected: props.selected, disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) props.onSelect();
            }}
            {...press.handlers}
        >
            <text>{optionLabel(props.option)}</text>
            {props.selected
                ? <view {...partBag(anatomy, 'item-indicator', { flags: { selected: true }, ...partAxes(props.axes) })} />
                : null}
        </view>
    );
}, { name: 'Select.Item' });

export type SelectRootProps =
    & Define.Model<string>
    & Define.Prop<'options', SelectOption[], true>
    & Define.Prop<'defaultValue', string, false>
    & Define.Event<'valueChange', string>
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
    & Define.Prop<'class', string, false>;

const SelectRoot = component<SelectRootProps>(({ props, emit }) => {
    const value = createControllableState<string>(
        () => props.model,
        props.defaultValue ?? '',
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

    const selected = (): SelectOption | undefined =>
        props.options.find((option) => option.value === value.value);
    const triggerState = () => (open.value ? 'open' : 'closed');
    const pick = (option: SelectOption): void => {
        value.value = option.value;
        open.value = false;
    };

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
                        {segmentOptions(props.options).map((segment, index) =>
                            segment.group !== undefined
                                ? (
                                    <view key={`g-${segment.group}`} {...partBag(anatomy, 'group', { ...partAxes(axes()) })}>
                                        <text {...partBag(anatomy, 'group-label', { ...partAxes(axes()) })}>
                                            {segment.group}
                                        </text>
                                        {segment.options.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                option={option}
                                                selected={option.value === value.value}
                                                axes={axes()}
                                                onSelect={() => pick(option)}
                                            />
                                        ))}
                                    </view>
                                )
                                : segment.options.map((option) => (
                                    <SelectItem
                                        key={`u-${index}-${option.value}`}
                                        option={option}
                                        selected={option.value === value.value}
                                        axes={axes()}
                                        onSelect={() => pick(option)}
                                    />
                                )))}
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
                        placeholder: !selected(),
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
                <text {...partBag(anatomy, 'value', { flags: { placeholder: !selected() }, ...partAxes(axes()) })}>
                    {(() => {
                        const current = selected();
                        return current ? optionLabel(current) : props.placeholder ?? '';
                    })()}
                </text>
                <view {...partBag(anatomy, 'indicator', { state: triggerState(), ...partAxes(axes()) })} />
            </view>
        </view>
    );
}, { name: 'Select.Root' });

export const Select = compound(SelectRoot, { Root: SelectRoot });
