/**
 * `<Tabs>` — Lynx tab navigator.
 *
 * Usage:
 *
 * ```tsx
 * <NavigationRoot routes={routes} initialRoute="root">
 *   <Stack />
 * </NavigationRoot>
 *
 * // The route "root" component renders:
 * <Tabs initialTab="feed">
 *   <Tabs.Screen name="feed" icon={<FeedIcon />} label="Feed">
 *     <Stack initialRoute="feedHome" />
 *   </Tabs.Screen>
 *   <Tabs.Screen name="me" icon={<MeIcon />} label="Profile">
 *     <Stack initialRoute="profileHome" />
 *   </Tabs.Screen>
 *   <TabBar />
 * </Tabs>
 * ```
 *
 * Tab bodies stay mounted across switches (the inactive ones render with
 * `display: 'none'`), so each tab's nested `<Stack>` keeps its history when
 * the user flips back to it. The active tab is reactive via `useTabs()`.
 *
 * Per-tab stacks: each `<Tabs.Screen>` can host a `<Stack initialRoute="…">`
 * which mints its own navigator. `useNav()` inside that subtree resolves to
 * the tab's stack, so `nav.push('card-route', …)` stays inside the tab.
 * Routes presented as `modal` / `fullScreen` / `transparent-modal` escalate
 * up `nav.parent` to the root navigator automatically — they overlay the
 * tabs UI (TabBar included) and dismiss back into the originating tab.
 */
import {
    component,
    compound,
    defineInjectable,
    defineProvide,
    onUnmounted,
    signal,
    untrack,
    type Define,
    type JSXElement,
    type Signal,
} from '@sigx/lynx';

/** Metadata about a registered `<Tabs.Screen>`. */
export interface TabInfo {
    /** Stable tab id, used by `setActive`. */
    readonly name: string;
    /** Optional icon node — passed through to the default tab bar. */
    readonly icon?: JSXElement;
    /** Optional human-readable label. Defaults to `name`. */
    readonly label?: string;
    /**
     * Accessibility label announced by screen readers. Falls back to
     * `label`, then `name`. Surfaced as `accessibility-label` on the
     * default `<TabBar>` button.
     */
    readonly accessibilityLabel?: string;
}

/** Reactive controller exposed by `useTabs()`. */
export interface TabsNav {
    /** Currently-active tab name. Reactive — accessing inside render/effect tracks. */
    readonly active: string;
    /** Switch the active tab. Triggers reactive updates in any consumer. */
    setActive(name: string): void;
    /** Snapshot of registered tabs in registration order. Reactive. */
    readonly tabs: ReadonlyArray<TabInfo>;
}

/**
 * Access the enclosing Tabs navigator. Throws when called outside `<Tabs>`.
 */
export const useTabs = defineInjectable<TabsNav>(() => {
    throw new Error(
        '[lynx-navigation] useTabs() called outside of a <Tabs> component.',
    );
});

/**
 * Internal registrar used by `<Tabs.Screen>` to announce itself to the
 * parent `<Tabs>`. Splitting registration off the public `useTabs()` keeps
 * the public surface read-only.
 */
interface TabsRegistrar {
    register(info: TabInfo): void;
    unregister(name: string): void;
    /** Reactive list — mirrors `TabsNav.tabs`, used by `<Tabs.Screen>` to
     *  decide whether it's the active tab. */
    readonly tabs: Signal<TabInfo[]>;
    readonly activeSignal: Signal<{ value: string | null }>;
}

const useTabsRegistrar = defineInjectable<TabsRegistrar>(() => {
    throw new Error(
        '[lynx-navigation] <Tabs.Screen> rendered outside a <Tabs> component.',
    );
});

/**
 * @internal
 * Provided by each `<Tabs.Screen>` so a nested `<Stack initialRoute>` can
 * discover *which* tab it's hosted by, and gate its focus state on that
 * tab being active. Throws when called outside a `<Tabs.Screen>` body so
 * the gate degrades to "always active" via the caller's try/catch.
 */
export const useTabScreenName = defineInjectable<string>(() => {
    throw new Error(
        '[lynx-navigation] useTabScreenName() called outside a <Tabs.Screen> body.',
    );
});

type TabsProps =
    & Define.Prop<'initialTab', string>
    & Define.Slot<'default'>;

const _Tabs = component<TabsProps>(({ props, slots }) => {
    // Tabs are stored as a deeply-reactive proxy signal so `tabs` consumers
    // re-render when registration changes. `activeSignal` uses the wrapped
    // `{value}` pattern so we can write a `string | null` without the
    // proxy treating the inner string as an object.
    const tabs = signal<TabInfo[]>([]);
    const activeSignal: Signal<{ value: string | null }> = signal({
        value: props.initialTab ?? null,
    });

    const registrar: TabsRegistrar = {
        register(info) {
            // Wrap in untrack so registration writes inside `<Tabs.Screen>`'s
            // setup phase don't notify the same setup effect that issued them
            // — sigx's setup runs in a tracked scope by default.
            untrack(() => {
                const idx = tabs.findIndex((t) => t.name === info.name);
                if (idx === -1) tabs.push(info);
                else tabs[idx] = info;
                if (activeSignal.value === null) {
                    activeSignal.value = info.name;
                }
            });
        },
        unregister(name) {
            untrack(() => {
                const idx = tabs.findIndex((t) => t.name === name);
                if (idx !== -1) tabs.splice(idx, 1);
                if (activeSignal.value === name) {
                    activeSignal.value = tabs[0]?.name ?? null;
                }
            });
        },
        tabs,
        activeSignal,
    };

    const nav: TabsNav = {
        get active() {
            // Empty-tabs state is rare in practice (no <Tabs.Screen> yet) but
            // possible during initial render; expose '' rather than null so
            // consumers can compare strings without narrowing.
            return activeSignal.value ?? '';
        },
        setActive(name) {
            // Silently ignore unknown names rather than writing them and
            // hiding every tab body. Surfacing as a no-op gives consumers a
            // predictable failure mode for typos / dynamic name sources.
            if (!tabs.some((t) => t.name === name)) return;
            activeSignal.value = name;
        },
        get tabs() {
            return tabs;
        },
    };

    defineProvide(useTabs, () => nav);
    defineProvide(useTabsRegistrar, () => registrar);

    return () => slots.default?.();
});

type TabsScreenProps =
    & Define.Prop<'name', string, true>
    & Define.Prop<'icon', JSXElement>
    & Define.Prop<'label', string>
    & Define.Prop<'accessibilityLabel', string>
    & Define.Slot<'default'>;

const TabsScreen = component<TabsScreenProps>(({ props, slots }) => {
    const registrar = useTabsRegistrar();
    // Capture `name` once at setup. Props is reactive in sigx, but using a
    // changing `name` for an already-registered screen would be ambiguous
    // (rename vs re-register?) — pin it and require callers to remount on
    // identity change. This matches React Navigation's contract.
    const name = props.name;
    registrar.register({
        name,
        icon: props.icon,
        label: props.label,
        accessibilityLabel: props.accessibilityLabel,
    });
    onUnmounted(() => registrar.unregister(name));

    // Expose this screen's tab name so a nested `<Stack initialRoute>` body
    // can gate its locally-focused state on `tabs.active === name`.
    defineProvide(useTabScreenName, () => name);

    return () => {
        // `display: none` keeps the body mounted so per-tab state survives
        // tab switches. Read activeSignal here so re-activating triggers a
        // re-render with display restored.
        //
        // Flex-fill long-form (`flex-grow/shrink/basis`) instead of
        // `height: '100%'`. The percentage form only resolves against an
        // explicit parent height, which means consumers had to wrap us
        // in a `flexFill + height: '100%'` view to make us visible — and
        // every Lynx app got that wrong (myself included) until we hit
        // it on the showcase. With flex-fill we just take whatever space
        // our parent flex container gives us; the parent only needs to
        // be a flex column with a known height (e.g. SafeAreaView, which
        // now defaults to that).
        const active = registrar.activeSignal.value === name;
        return (
            <view
                style={{
                    display: active ? 'flex' : 'none',
                    flexDirection: 'column',
                    width: '100%',
                    flexGrow: 1,
                    flexShrink: 1,
                    flexBasis: 0,
                    minHeight: 0,
                }}
            >
                {slots.default?.()}
            </view>
        );
    };
});

/**
 * Compound export. `Tabs` is the parent component; `Tabs.Screen` registers
 * an individual tab. Matches the `Screen` / `Screen.Header` shape used
 * elsewhere in this package and the daisyui `Modal` / `Modal.Header`
 * convention.
 */
export const Tabs = compound(_Tabs, {
    Screen: TabsScreen,
});
