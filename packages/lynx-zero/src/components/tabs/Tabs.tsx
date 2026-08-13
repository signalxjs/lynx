/**
 * Tabs — the roving-degenerate case: no keyboard on this platform, so
 * activation is a tap, and the list controller runs in registration-order
 * mode (never handed elements; depth-first render order IS visual order).
 * Inactive panels UNMOUNT rather than hide: lynx has no `hidden` attribute
 * and no attribute selectors to honor one (the web's `[hidden]` structure
 * rule cannot exist here), so absence is the platform's spelling of the
 * anatomy's `hiddenIn: ['inactive']` promise — the oracle walks rendered
 * parts, and the only panel it ever sees is the active, visible one. The
 * cost is panel state not surviving a tab switch; v1 accepts it.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, onUnmounted } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { ListController } from '@sigx/zero/behaviors/core';
import { createControllableState, createId, createListController, useFieldContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies.tabs;

type Orientation = 'horizontal' | 'vertical';

interface TabsContext {
    selected(): string | null;
    select(value: string): void;
    orientation(): Orientation;
    list: ListController;
    id: string;
}

const makeInertTabs = (): TabsContext => ({
    selected: () => null,
    select: () => {},
    orientation: () => 'horizontal',
    list: createListController(),
    id: 'zx-tabs-inert',
});

const useTabsContext = defineInjectable<TabsContext>(makeInertTabs);

export type TabsRootProps =
    & Define.Model<string>
    & Define.Prop<'defaultValue', string, false>
    & Define.Event<'valueChange', string>
    & Define.Prop<'orientation', Orientation, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const TabsRoot = component<TabsRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<string | null>(
        () => props.model as never,
        props.defaultValue ?? null,
        (value) => {
            if (value !== null) emit('valueChange', value);
        },
    );
    const orientation = (): Orientation => props.orientation ?? 'horizontal';
    const axes = (): VariantAxes => ({ color: props.color, size: props.size, variant: props.variant });
    provideVariantAxes(axes);
    const ctx: TabsContext = {
        selected: () => state.value,
        select: (value) => {
            state.value = value;
        },
        orientation,
        list: createListController(),
        id: createId('zx-tabs'),
    };
    defineProvide(useTabsContext, () => ctx);

    return () => (
        <view {...partBag(anatomy, 'root', { orientation: orientation(), ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Tabs.Root' });

type ListPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const TabsList = component<ListPartProps>(({ props, slots }) => {
    const tabs = useTabsContext();
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'list', { orientation: tabs.orientation(), ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Tabs.List' });

export type TabProps =
    & Define.Prop<'value', string, true>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const TabsTab = component<TabProps>(({ props, slots }) => {
    const tabs = useTabsContext();
    const field = useFieldContext();
    const axes = useVariantAxes();
    const disabled = () => !!props.disabled || field.disabled();
    const press = createPressFeedback({ isDisabled: disabled });
    const unregister = tabs.list.register({
        id: createId('zx-tab'),
        value: props.value,
        disabled,
        // Registration-order mode: never hand the controller an element.
        el: () => null,
        textValue: () => props.value,
    });
    onUnmounted(unregister);
    const isActive = () => tabs.selected() === props.value;

    return () => (
        <view
            {...partBag(anatomy, 'tab', {
                state: isActive() ? 'active' : 'inactive',
                flags: { disabled: disabled(), pressed: press.pressed() },
                orientation: tabs.orientation(),
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', selected: isActive(), disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) tabs.select(props.value);
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Tabs.Tab' });

export type PanelProps =
    & Define.Prop<'value', string, true>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const TabsPanel = component<PanelProps>(({ props, slots }) => {
    const tabs = useTabsContext();
    const axes = useVariantAxes();
    const isActive = () => tabs.selected() === props.value;
    // See the module doc: absence is this platform's `hiddenIn`.
    return () => (isActive()
        ? (
            <view {...partBag(anatomy, 'panel', {
                state: 'active',
                orientation: tabs.orientation(),
                ...partAxes(axes()),
                class: props.class,
            })}
            >
                {slots.default?.()}
            </view>
        )
        : undefined);
}, { name: 'Tabs.Panel' });

export const Tabs = compound(TabsRoot, {
    Root: TabsRoot,
    List: TabsList,
    Tab: TabsTab,
    Panel: TabsPanel,
});
