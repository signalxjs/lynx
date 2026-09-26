/**
 * Tabs — the roving-degenerate case: no keyboard on this platform, so
 * activation is a tap, and the list controller runs in registration-order
 * mode (never handed elements; depth-first render order IS visual order).
 * Inactive panels UNMOUNT rather than hide: lynx has no `hidden` attribute
 * and no attribute selectors to honor one (the web's `[hidden]` structure
 * rule cannot exist here), so absence is the platform's spelling of the
 * anatomy's `hiddenIn: ['inactive']` promise — the oracle walks rendered
 * parts, and the only panel it ever sees is the active, visible one. The
 * cost is panel state not surviving a tab switch — this platform always
 * behaves as zero's `unmountOnExit`, so the web's `lazyMount` and
 * `unmountOnExit` Root props have nothing to switch here and are not taken.
 *
 * The indicator (zero#324) is the one tab style a class rule cannot express
 * alone: a mark over whichever tab is active. It positions itself from the
 * tabs' measured geometry (see `indicator.ts`); the skin only paints it. A
 * `Tabs.List` renders one on its own unless the app places a
 * `Tabs.Indicator` in it — on lynx it is the platform's spelling of the
 * `::before` marks daisy draws on the active tab, which this target drops,
 * so the underline must not depend on the app remembering the part.
 */
import type { Define, LayoutChangeEvent, UseViewportRectResult } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, effect, onMounted, onUnmounted, signal, useViewportRect } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { ListController } from '@sigx/zero/behaviors/core';
import { createControllableState, createId, createListController, useFieldContext } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import type { IndicatorRect, IndicatorSize } from './indicator.js';
import { computeIndicatorBox, indicatorStyle } from './indicator.js';

const anatomy = anatomies.tabs;

type Orientation = 'horizontal' | 'vertical';

/** One tab's two measurements (see `indicator.ts` for why both). */
interface TabGeometry {
    rect(): IndicatorRect | null;
    size(): IndicatorSize | null;
    measure(): void;
}

/**
 * The geometry the indicator reads: the list's viewport rect and every tab's,
 * keyed by value. Measuring is gated on an indicator being mounted — a tabs
 * row nobody draws a mark for never pays for a measurement.
 */
interface TabsGeometry {
    setList(rect: UseViewportRectResult | null): void;
    listRect(): IndicatorRect | null;
    registerTab(value: string, geometry: TabGeometry): () => void;
    tab(value: string): TabGeometry | undefined;
    /** Mount an indicator; returns its unmount. `explicit` = placed by the app. */
    mountIndicator(explicit: boolean): () => void;
    /** How many app-placed `Tabs.Indicator`s are mounted (suppresses the list's own). */
    explicitIndicators(): number;
    /** Re-measure the list and every tab together, when an indicator is mounted. */
    measure(): void;
}

interface TabsContext {
    selected(): string | null;
    select(value: string): void;
    orientation(): Orientation;
    list: ListController;
    geometry: TabsGeometry;
    id: string;
}

function createTabsGeometry(): TabsGeometry {
    const tabs = new Map<string, TabGeometry>();
    // Bumped on every registry change so readers of `tab()` re-run.
    const version = signal(0);
    // Held outside any signal: a reactive object would deep-proxy the
    // measurement handle (its SharedValue) — the version bump is the signal.
    let list: UseViewportRectResult | null = null;
    const indicators = signal({ all: 0, explicit: 0 });
    const measure = (): void => {
        if (indicators.all === 0) return;
        list?.measure();
        for (const tab of tabs.values()) tab.measure();
    };
    return {
        setList: (rect) => {
            list = rect;
            version.value++;
            measure();
        },
        listRect: () => {
            void version.value;
            return list?.rect.value ?? null;
        },
        registerTab: (value, geometry) => {
            tabs.set(value, geometry);
            version.value++;
            if (indicators.all > 0) geometry.measure();
            return () => {
                if (tabs.get(value) === geometry) tabs.delete(value);
                version.value++;
            };
        },
        tab: (value) => {
            void version.value;
            return tabs.get(value);
        },
        mountIndicator: (explicit) => {
            indicators.all++;
            if (explicit) indicators.explicit++;
            measure();
            return () => {
                indicators.all--;
                if (explicit) indicators.explicit--;
            };
        },
        explicitIndicators: () => indicators.explicit,
        measure,
    };
}

const makeInertTabs = (): TabsContext => ({
    selected: () => null,
    select: () => {},
    orientation: () => 'horizontal',
    list: createListController(),
    geometry: createTabsGeometry(),
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
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size, variant: props.variant }));
    const ctx: TabsContext = {
        selected: () => state.value,
        select: (value) => {
            state.value = value;
        },
        orientation,
        list: createListController(),
        geometry: createTabsGeometry(),
        id: createId('zx-tabs'),
    };
    defineProvide(useTabsContext, () => ctx);

    return () => (
        <view {...partBag(anatomy, 'root', { orientation: orientation(), ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Tabs.Root' });

export type TabsListProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const TabsList = component<TabsListProps>(({ props, slots }) => {
    const tabs = useTabsContext();
    const axes = useVariantAxes();
    const rect = useViewportRect();
    tabs.geometry.setList(rect);
    onUnmounted(() => tabs.geometry.setList(null));
    return () => (
        <view
            {...partBag(anatomy, 'list', { orientation: tabs.orientation(), ...partAxes(axes()), class: props.class })}
            main-thread:ref={rect.ref}
            bindlayoutchange={() => tabs.geometry.measure()}
        >
            {slots.default?.()}
            {tabs.geometry.explicitIndicators() === 0 ? <IndicatorView explicit={false} /> : null}
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

    // The indicator's two inputs: the viewport rect (position) and the
    // layout frame (transform-blind size) — see indicator.ts.
    const rect = useViewportRect();
    const size = signal<{ value: IndicatorSize | null }>({ value: null });
    // Registered under the value it had at setup: `value` is this tab's
    // identity in the list controller too, which is not re-keyed either.
    onUnmounted(tabs.geometry.registerTab(props.value, {
        rect: () => rect.rect.value,
        size: () => size.value,
        measure: rect.measure,
    }));
    const onLayout = (e: LayoutChangeEvent): void => {
        const frame = e.detail ?? e.params;
        if (frame && frame.width > 0 && frame.height > 0) {
            size.value = { width: frame.width, height: frame.height };
        }
        // A tab that resized moves its siblings too: re-measure the row.
        tabs.geometry.measure();
    };

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
            main-thread:ref={rect.ref}
            bindlayoutchange={onLayout}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Tabs.Tab' });

type IndicatorViewProps =
    & Define.Prop<'explicit', boolean, true>
    & Define.Prop<'class', string, false>;

/**
 * The indicator part itself — the list's own instance and the app-placed
 * `Tabs.Indicator` both render through it.
 */
const IndicatorView = component<IndicatorViewProps>(({ props }) => {
    const tabs = useTabsContext();
    const axes = useVariantAxes();
    // One turn after mount: an app-placed part mounts inside the list's own
    // render pass, and a count that render reads must change after the pass
    // has finished or the list never sees it. (A promise, not
    // `queueMicrotask`: the background thread lacks it on some engines.)
    let unmount: (() => void) | null = null;
    let alive = true;
    onMounted(() => {
        void Promise.resolve().then(() => {
            if (alive) unmount = tabs.geometry.mountIndicator(props.explicit);
        });
    });
    onUnmounted(() => {
        alive = false;
        unmount?.();
    });
    // A new selection re-measures the row: the rects on hand may predate a
    // scroll that moved the list and tabs by different amounts only if they
    // were measured apart, and a fresh pair is cheap.
    effect(() => {
        void tabs.selected();
        void tabs.orientation();
        tabs.geometry.measure();
    });
    const box = () => {
        const value = tabs.selected();
        const tab = value === null ? undefined : tabs.geometry.tab(value);
        return tab ? computeIndicatorBox(tabs.geometry.listRect(), tab.rect(), tab.size()) : null;
    };
    return () => (
        <view
            {...partBag(anatomy, 'indicator', { orientation: tabs.orientation(), ...partAxes(axes()), class: props.class })}
            // Decoration: the tabs carry the semantics (zero's `aria-hidden`).
            accessibility-element={false}
            style={indicatorStyle(box())}
        />
    );
}, { name: 'Tabs.IndicatorView' });

export type TabsIndicatorProps = Define.Prop<'class', string, false>;

/**
 * Place the indicator explicitly (to give it a class, or to order it among
 * the list's children). Without one, `Tabs.List` renders its own.
 */
const TabsIndicator = component<TabsIndicatorProps>(({ props }) => {
    return () => <IndicatorView explicit class={props.class} />;
}, { name: 'Tabs.Indicator' });

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
    Indicator: TabsIndicator,
    Panel: TabsPanel,
});
