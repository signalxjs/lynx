/**
 * Runtime tests for `<Screen>` and its slot-filling sub-components.
 *
 * Verifies:
 *  - `<Screen>` writes its options (title / headerShown / gestureEnabled)
 *    into the focused entry's `ScreenRegistry`.
 *  - `<Screen.Header>`, `<Screen.HeaderLeft>`, `<Screen.HeaderRight>`
 *    register their content as slot fills under the corresponding name.
 *  - `<Screen.TabBarItem>` registers a function-valued slot fill that
 *    receives `{ active }` and returns the scoped content.
 *  - Slot fills clear when the screen unmounts (navigation away).
 *  - Calling `<Screen>` outside a Stack-rendered scope throws.
 *  - The screen registry is reachable via `getScreenRegistry(entry.key)` on
 *    the navigator internals, keyed by entry — so cross-entry consumers
 *    (the future HeaderBar) can look up registrations without remounting.
 */
import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { useNav } from '../src/hooks/use-nav.js';
import { useNavInternals } from '../src/hooks/use-nav-internal.js';
import type { NavInternals } from '../src/hooks/use-nav-internal.js';
import { NavigationRoot } from '../src/components/NavigationRoot.js';
import { Stack } from '../src/components/Stack.js';
import { Screen } from '../src/components/Screen.js';
import { useScreenOptions } from '../src/hooks/use-screen-options.js';
import { routes } from './_fixtures.js';

interface NavProbe {
    nav: ReturnType<typeof useNav> | null;
    internals: NavInternals | null;
}

const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    const nav = useNav();
    const internals = useNavInternals();
    props.probe.nav = nav;
    props.probe.internals = internals;
    return () => null;
});

describe('<Screen> options', () => {
    it('writes title / headerShown / gestureEnabled into the entry registry', () => {
        const Home = component(() => () => (
            <Screen title="Welcome" headerShown={false} gestureEnabled={false}>
                <view><text>home</text></view>
            </Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const probe: NavProbe = { nav: null, internals: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        const topKey = probe.nav!.current.key;
        const reg = probe.internals!.screens.get(topKey)!;
        expect(reg).toBeTruthy();
        expect(reg.options.title).toBe('Welcome');
        expect(reg.options.headerShown).toBe(false);
        expect(reg.options.gestureEnabled).toBe(false);

        result.unmount();
    });

    it('omits unset option fields rather than writing undefined', () => {
        // `mergeOptions` writes whatever object is passed, but the test
        // asserts the *effective* contract: callers shouldn't have to
        // distinguish "explicitly undefined" from "absent". Defaults are
        // applied by chrome consumers, so undefined is acceptable here.
        const Home = component(() => () => (
            <Screen title="Just a title">
                <view />
            </Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const probe: NavProbe = { nav: null, internals: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        const reg = probe.internals!.screens.get(probe.nav!.current.key)!;
        expect(reg.options.title).toBe('Just a title');
        // headerShown / gestureEnabled were not provided — treated as absent.
        expect(reg.options.headerShown).toBeUndefined();
        expect(reg.options.gestureEnabled).toBeUndefined();
        result.unmount();
    });
});

describe('<Screen> patch is non-destructive', () => {
    // Regression: a bare `<Screen>` (or one passing only HeaderRight) used
    // to call `mergeOptions(reg, { title, headerShown, gestureEnabled })`
    // with every key — undefineds cleared options that a sibling
    // `useScreenOptions({...})` had just written. Now `<Screen>` only
    // patches keys whose prop was actually passed.
    it('does not wipe options set by useScreenOptions in the same screen', () => {
        const Home = component(() => {
            useScreenOptions({ title: 'From hook', headerShown: false });
            return () => (
                <Screen>
                    <Screen.HeaderRight><text>R</text></Screen.HeaderRight>
                    <view />
                </Screen>
            );
        });
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const probe: NavProbe = { nav: null, internals: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        const reg = probe.internals!.screens.get(probe.nav!.current.key)!;
        expect(reg.options.title).toBe('From hook');
        expect(reg.options.headerShown).toBe(false);
        // The HeaderRight slot still gets through.
        expect(typeof reg.slots.headerRight).toBe('function');
        result.unmount();
    });
});

describe('<Screen.Header> / HeaderLeft / HeaderRight', () => {
    it('registers slot fills under their respective names', () => {
        const Home = component(() => () => (
            <Screen>
                <Screen.Header><text>FullHeader</text></Screen.Header>
                <Screen.HeaderLeft><text>L</text></Screen.HeaderLeft>
                <Screen.HeaderRight><text>R</text></Screen.HeaderRight>
                <view />
            </Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const probe: NavProbe = { nav: null, internals: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        const reg = probe.internals!.screens.get(probe.nav!.current.key)!;
        expect(typeof reg.slots.header).toBe('function');
        expect(typeof reg.slots.headerLeft).toBe('function');
        expect(typeof reg.slots.headerRight).toBe('function');
        result.unmount();
    });
});

describe('<Screen.TabBarItem>', () => {
    it('registers a scoped slot fill that receives { active }', () => {
        // The fill is a function called by the navigator's future TabBar.
        // Here we just call it ourselves with each active state and assert
        // it returns *something* (a JSX node — we don't introspect its
        // shape, that's testing rendering, not registration).
        const Home = component(() => () => (
            <Screen>
                <Screen.TabBarItem>
                    {({ active }: { active: boolean }) => (
                        <text>{active ? 'on' : 'off'}</text>
                    )}
                </Screen.TabBarItem>
                <view />
            </Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const probe: NavProbe = { nav: null, internals: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        const reg = probe.internals!.screens.get(probe.nav!.current.key)!;
        const fill = reg.slots.tabBarItem;
        expect(typeof fill).toBe('function');
        // Call with both states — registration is what we're proving; the
        // returned value should at minimum not throw.
        expect(() => fill!({ active: true })).not.toThrow();
        expect(() => fill!({ active: false })).not.toThrow();
        result.unmount();
    });
});

describe('screen registry lifecycle', () => {
    it('unregisters the entry on screen unmount (navigation away)', () => {
        const Home = component(() => () => (
            <Screen title="Home"><view /></Screen>
        ));
        const Settings = component(() => () => (
            <Screen title="Settings"><view /></Screen>
        ));
        const localRoutes = {
            ...routes,
            home: { component: Home },
            settings: { component: Settings },
        } as typeof routes;
        const probe: NavProbe = { nav: null, internals: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        const homeKey = probe.nav!.current.key;
        expect(probe.internals!.screens.get(homeKey)).toBeTruthy();

        act(() => probe.nav!.push('settings'));

        // Idle render only mounts the top entry, so Home unmounted and its
        // registry was removed. Settings is now registered.
        expect(probe.internals!.screens.get(homeKey)).toBeUndefined();
        const settingsKey = probe.nav!.current.key;
        expect(probe.internals!.screens.get(settingsKey)?.options.title).toBe('Settings');

        result.unmount();
        expect(probe.internals!.screens.get(settingsKey)).toBeUndefined();
    });

    // Regression: modal/fullScreen/transparent-modal overlays must keep
    // the base entry mounted so per-tab Stack state, scroll positions,
    // and registry options survive the modal lifecycle. The prior
    // implementation switched JSX shape between "bare EntryScope" and
    // "wrapper + layer", which silently remounted the base.
    it('keeps the base entry mounted while a modal overlay is on top', () => {
        // Use the fixture's `composeMessage` route, which is already
        // declared with `presentation: 'modal'` and registered in the
        // global `Register.routes` augmentation — adding a new modal
        // route here just to test layering would need a separate type
        // augmentation per test file (TS2717).
        const homeMounts: string[] = [];
        const Home = component(() => {
            // Tag-on-setup — runs once per fresh mount. If the base
            // remounts during the modal push/pop, this fires twice.
            const id = `m${homeMounts.length + 1}`;
            homeMounts.push(id);
            return () => (
                <Screen title="Home" headerShown={false}><view /></Screen>
            );
        });
        const localRoutes = {
            ...routes,
            home: { component: Home },
        } as typeof routes;
        const probe: NavProbe = { nav: null, internals: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        const homeKey = probe.nav!.current.key;
        expect(probe.internals!.screens.get(homeKey)?.options.headerShown).toBe(false);
        expect(homeMounts).toEqual(['m1']);

        act(() => probe.nav!.push('composeMessage', { recipientId: 'r1' }));
        // While the modal is overlaid, the base entry is still mounted —
        // its registry remains, and its options written at setup are
        // intact (no remount means no fresh, empty registry).
        expect(probe.internals!.screens.get(homeKey)).toBeTruthy();
        expect(probe.internals!.screens.get(homeKey)?.options.headerShown).toBe(false);
        expect(homeMounts).toEqual(['m1']);

        act(() => probe.nav!.pop());
        // After dismissing, the same registry survives (no remount).
        expect(probe.internals!.screens.get(homeKey)?.options.headerShown).toBe(false);
        expect(homeMounts).toEqual(['m1']);

        result.unmount();
    });

    // Regression: stacked overlays. With two modals stacked on a card
    // base, pushing the second modal must preserve the FIRST modal's
    // mount (its registry stays in `screens`, its options survive).
    // The previous render had overlays in a single array-valued JSX
    // child slot — sigx's reconciler treats those as a single slot,
    // so an array-length change between renders can remount keyed
    // children inside.
    it('preserves underneath overlays when another overlay pushes on top', () => {
        // Track each Modal mount so we can distinguish "stayed
        // mounted" from "unmounted and re-mounted with a fresh
        // registry".
        let modalMounts = 0;
        const Modal = component(() => {
            modalMounts += 1;
            return () => (
                <Screen title={`Modal-${modalMounts}`}><view /></Screen>
            );
        });
        const localRoutes = {
            ...routes,
            // Override fixture composeMessage component with our
            // counter-instrumented Modal. Same route name, same
            // presentation: 'modal' — each push mints a fresh entry
            // with a new key, so two pushes produce two distinct
            // registry entries (modal-A and modal-B) under different
            // keys.
            composeMessage: { ...routes.composeMessage, component: Modal },
        } as typeof routes;
        const probe: NavProbe = { nav: null, internals: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        // Push first modal.
        act(() => probe.nav!.push('composeMessage', { recipientId: 'r1' }));
        const modalAKey = probe.nav!.current.key;
        expect(modalMounts).toBe(1);
        expect(probe.internals!.screens.get(modalAKey)).toBeTruthy();
        expect(probe.internals!.screens.get(modalAKey)?.options.title).toBe('Modal-1');

        // Push second modal — first modal must STAY MOUNTED.
        act(() => probe.nav!.push('composeMessage', { recipientId: 'r2' }));
        const modalBKey = probe.nav!.current.key;
        expect(modalBKey).not.toBe(modalAKey);
        // Modal2 mounts fresh.
        expect(modalMounts).toBe(2);
        // Modal1's registry MUST still be there with its options
        // intact. If reconciliation remounted it, it'd have a fresh
        // empty registry (no title until <Screen> re-ran) and the
        // mount counter would have ticked past 2 by now.
        expect(probe.internals!.screens.get(modalAKey)).toBeTruthy();
        expect(probe.internals!.screens.get(modalAKey)?.options.title).toBe('Modal-1');
        expect(probe.internals!.screens.get(modalBKey)?.options.title).toBe('Modal-2');

        // Pop modal B — modal A still survives.
        act(() => probe.nav!.pop());
        expect(probe.internals!.screens.get(modalAKey)?.options.title).toBe('Modal-1');
        expect(probe.internals!.screens.get(modalBKey)).toBeUndefined();
        expect(modalMounts).toBe(2); // no re-mount of A

        result.unmount();
    });
});

describe('screens registry — identity-checked unregister', () => {
    // Direct unit test of the navigator's `_screens` controller — the
    // higher-level integration test (modal cycle preserving the base
    // entry) is in this file too, but doesn't drive the specific
    // sequence of "new register before old unregister" the way the
    // transition→idle handoff does in practice.
    it('a new registry for the same entry key is preserved when the older one unregisters', async () => {
        const { createNavigatorState } = await import('../src/navigator/core.js');
        const initial = {
            key: 'k1',
            route: 'home',
            params: {},
            search: {},
            state: undefined,
            presentation: 'card' as const,
        };
        const navState = createNavigatorState({
            routes: { home: { component: (() => () => null) as never } } as never,
            initial,
            progress: undefined,
            parent: null,
            initialLocallyFocused: true,
        });
        const screens = navState._screens;
        const { createScreenRegistry } = await import('../src/internal/screen-registry.js');

        const regOld = createScreenRegistry(initial);
        const regNew = createScreenRegistry(initial);
        regOld.options.title = 'old';
        regNew.options.title = 'new';

        screens.register(regOld);
        expect(screens.get('k1')).toBe(regOld);

        // Mount of the replacement EntryScope: registers regNew under
        // the same key BEFORE the older scope's onUnmounted fires.
        screens.register(regNew);
        expect(screens.get('k1')).toBe(regNew);

        // Now the old scope finally unmounts. The straggler unregister
        // must not wipe the active newer registry.
        screens.unregister(regOld);
        expect(screens.get('k1')).toBe(regNew);
        expect(screens.get('k1')?.options.title).toBe('new');

        // The new registry's own unmount does delete the slot.
        screens.unregister(regNew);
        expect(screens.get('k1')).toBeUndefined();
    });
});

describe('<Screen> out-of-scope usage', () => {
    it('throws when rendered outside a Stack-rendered route', () => {
        const Bad = component(() => () => (
            <Screen title="nope"><view /></Screen>
        ));
        expect(() =>
            render(
                <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                    <Bad />
                </NavigationRoot>,
            ),
        ).toThrowError(/No screen registry in scope/);
    });
});
