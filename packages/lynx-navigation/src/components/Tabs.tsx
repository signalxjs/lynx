/**
 * `<Tabs>` — Lynx tab navigator.
 *
 * Usage:
 *
 * ```tsx
 * <NavigationRoot routes={routes}>
 *   <Tabs initialTab="feed">
 *     <Tabs.Screen name="feed" icon={<FeedIcon />} label="Feed">
 *       <FeedView />
 *     </Tabs.Screen>
 *     <Tabs.Screen name="me" icon={<MeIcon />} label="Profile">
 *       <ProfileView />
 *     </Tabs.Screen>
 *   </Tabs>
 * </NavigationRoot>
 * ```
 *
 * Scope of this slice (v0.1): pure UI primitive. Each tab's body stays
 * mounted for state preservation (the inactive ones render with
 * `display: 'none'`). Active tab is reactive via `useTabs()`.
 *
 * Out of scope (deferred to a nested-navigators slice):
 *   - Per-tab `<Stack>` with its own navigator state machine
 *   - `nav.parent` chain into the Tabs nav
 *   - Named navigators (`useNav('root')`)
 *
 * Those build on multi-navigator-state plumbing that isn't ready yet.
 * For now, the inner content of a `<Tabs.Screen>` shares the same nav as
 * its outer `<NavigationRoot>` — usable for shallow tab apps, but full
 * nested routing comes later.
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

    return () => {
        // `display: none` keeps the body mounted so per-tab state survives
        // tab switches. Read activeSignal here so re-activating triggers a
        // re-render with display restored.
        const active = registrar.activeSignal.value === name;
        return (
            <view
                style={{
                    display: active ? 'flex' : 'none',
                    width: '100%',
                    height: '100%',
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
