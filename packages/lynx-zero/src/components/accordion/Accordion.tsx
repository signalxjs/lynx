/**
 * Accordion — disclosure without `<details>`: the platform has no native
 * disclosure element, so open state is the controllable model and a closed
 * panel is simply not in the tree (its anatomy declares no `hiddenIn` — the
 * web's panel collapses via the native element). No `height: auto`
 * transitions exist on this target either — a skin animates
 * opacity/translate, or measures; the open/closed classes are the hook.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, useFieldContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies.accordion;

interface AccordionContext {
    isOpen(value: string): boolean;
    toggle(value: string): void;
}

const useAccordionContext = defineInjectable<AccordionContext>(() => ({
    isOpen: () => false,
    toggle: () => {},
}));

interface ItemContext {
    value(): string;
    open(): boolean;
    disabled(): boolean;
}

const useItemContext = defineInjectable<ItemContext>(() => ({
    value: () => '',
    open: () => false,
    disabled: () => false,
}));

export type AccordionRootProps =
    & Define.Model<string[]>
    & Define.Prop<'defaultValue', string[], false>
    & Define.Event<'valueChange', string[]>
    /** Allow more than one item open at once. */
    & Define.Prop<'multiple', boolean, false>
    /** Allow closing the last open item. */
    & Define.Prop<'collapsible', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const AccordionRoot = component<AccordionRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<string[]>(
        () => props.model,
        props.defaultValue ?? [],
        (value) => emit('valueChange', value),
    );
    const axes = (): VariantAxes => ({ color: props.color, size: props.size });
    provideVariantAxes(axes);
    const ctx: AccordionContext = {
        isOpen: (value) => state.value.includes(value),
        toggle: (value) => {
            const open = state.value.includes(value);
            if (open) {
                if (props.collapsible === false && state.value.length === 1) return;
                state.value = state.value.filter((v) => v !== value);
            } else {
                state.value = props.multiple ? [...state.value, value] : [value];
            }
        },
    };
    defineProvide(useAccordionContext, () => ctx);

    return () => (
        <view {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Accordion.Root' });

export type AccordionItemProps =
    & Define.Prop<'value', string, true>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const AccordionItem = component<AccordionItemProps>(({ props, slots }) => {
    const accordion = useAccordionContext();
    const field = useFieldContext();
    const axes = useVariantAxes();
    const disabled = () => !!props.disabled || field.disabled();
    const item: ItemContext = {
        value: () => props.value,
        open: () => accordion.isOpen(props.value),
        disabled,
    };
    defineProvide(useItemContext, () => item);

    return () => (
        <view {...partBag(anatomy, 'item', {
            state: item.open() ? 'open' : 'closed',
            flags: { disabled: disabled() },
            ...partAxes(axes()),
            class: props.class,
        })}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Accordion.Item' });

type PartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const AccordionTrigger = component<PartProps>(({ props, slots }) => {
    const accordion = useAccordionContext();
    const item = useItemContext();
    const axes = useVariantAxes();
    const press = createPressFeedback({ isDisabled: item.disabled });
    return () => (
        <view
            {...partBag(anatomy, 'trigger', {
                state: item.open() ? 'open' : 'closed',
                flags: { disabled: item.disabled(), pressed: press.pressed() },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', disabled: item.disabled() })}
            bindtap={() => {
                if (!item.disabled()) accordion.toggle(item.value());
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Accordion.Trigger' });

const AccordionPanel = component<PartProps>(({ props, slots }) => {
    const item = useItemContext();
    const axes = useVariantAxes();
    // Unmounted while closed (the lynx overlay idiom): the web's panel
    // collapses via <details>' native disclosure, which this platform lacks,
    // and the anatomy declares no hiddenIn — so a closed panel simply is not
    // in the tree. The oracle walks rendered parts; absence is legal.
    return () => (item.open()
        ? (
            <view {...partBag(anatomy, 'panel', { state: 'open', ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </view>
        )
        : undefined);
}, { name: 'Accordion.Panel' });

export const Accordion = compound(AccordionRoot, {
    Root: AccordionRoot,
    Item: AccordionItem,
    Trigger: AccordionTrigger,
    Panel: AccordionPanel,
});
