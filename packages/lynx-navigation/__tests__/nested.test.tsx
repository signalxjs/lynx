/**
 * Per-tab nested stacks.
 *
 * `<Stack initialRoute="…">` mints its own navigator so pushes from inside
 * a tab body stay local to the tab — until you push a non-card route
 * (modal / fullScreen / transparent-modal), which escalates to the root
 * navigator so it overlays everything.
 *
 * What we lock in here:
 *  - Card push from inside a tab stays in the inner nav. Root nav stack
 *    untouched.
 *  - Modal push from inside a tab escalates to root. Inner nav stack
 *    untouched.
 *  - `replace()` stays strictly local — never escalates (asymmetric with
 *    `push`). Locking this so a future "make it symmetric" PR can't quietly
 *    wipe the root stack.
 *  - `useIsFocused()` gates on tab-active state: a screen at the top of its
 *    own stack reports unfocused while its tab is inactive.
 *  - `nav.parent` points at the enclosing nav from an inner stack; root's
 *    parent is null.
 */
import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot.js';
import { Stack } from '../src/components/Stack.js';
import { Tabs } from '../src/components/Tabs.js';
import { useNav } from '../src/hooks/use-nav.js';
import { useIsFocused } from '../src/hooks/use-focus.js';
import type { Nav } from '../src/hooks/use-nav.js';
import type { Computed } from '@sigx/lynx';
import { routes, Home, Profile, Settings } from './_fixtures.js';

interface NavProbe { nav: Nav | null }

// Captures the local `useNav()` so a test can drive it without having to
// route through a button press or other UI affordance.
const Capture = component<{ probe: NavProbe } & {}>(({ props }) => {
    const nav = useNav();
    props.probe.nav = nav;
    return () => null;
});

// Captures a `useIsFocused()` Computed at the position it's set up — used to
// assert focus state from outside the component tree.
interface FocusProbe { focused: Computed<boolean> | null }
const FocusCapture = component<{ probe: FocusProbe } & {}>(({ props }) => {
    const focused = useIsFocused();
    props.probe.focused = focused;
    return () => null;
});

// Replace the bare home/profile/settings components in the registry with
// versions that hoist the nav for the test. Constructed inline so each test
// gets a fresh probe.
function makeProbedRoutes(): {
    rs: typeof routes;
    homeProbe: NavProbe;
    profileProbe: NavProbe;
    settingsProbe: NavProbe;
} {
    const homeProbe: NavProbe = { nav: null };
    const profileProbe: NavProbe = { nav: null };
    const settingsProbe: NavProbe = { nav: null };
    const HomeWithProbe = component(() => () => (
        <view>
            <Capture probe={homeProbe} />
            <text>HomeBody</text>
        </view>
    ));
    const ProfileWithProbe = component(() => () => (
        <view>
            <Capture probe={profileProbe} />
            <text>ProfileBody</text>
        </view>
    ));
    const SettingsWithProbe = component(() => () => (
        <view>
            <Capture probe={settingsProbe} />
            <text>SettingsBody</text>
        </view>
    ));
    const rs = {
        ...routes,
        home: { component: HomeWithProbe },
        profile: { ...routes.profile, component: ProfileWithProbe },
        settings: { component: SettingsWithProbe },
    } as typeof routes;
    return { rs, homeProbe, profileProbe, settingsProbe };
}

// The route at the root of the navigator: a Tabs UI with three tabs each
// hosting its own `<Stack initialRoute>`. Profile is given a static
// `id`/`tab` initialParams/Search so it satisfies its schema.
function makeRootTabs(): ReturnType<typeof component> {
    return component(() => () => (
        <Tabs initialTab="home">
            <Tabs.Screen name="home"><Stack initialRoute="home" /></Tabs.Screen>
            <Tabs.Screen name="profile">
                <Stack
                    initialRoute="profile"
                    initialParams={{ id: 'demo' }}
                    initialSearch={{ tab: 'posts' }}
                />
            </Tabs.Screen>
            <Tabs.Screen name="settings"><Stack initialRoute="settings" /></Tabs.Screen>
        </Tabs>
    ));
}

describe('<Stack initialRoute> — per-tab nested stacks', () => {
    it('card push from inside a tab stays in the inner nav', async () => {
        const { rs, homeProbe } = makeProbedRoutes();
        const RootTabs = makeRootTabs();
        const rootProbe: NavProbe = { nav: null };
        const rsWithTabs = { ...rs, root: { component: RootTabs } } as never;

        render(
            <NavigationRoot
                routes={rsWithTabs}
                initialRoute={'root' as never}
                animated={false}
            >
                <Capture probe={rootProbe} />
                <Stack />
            </NavigationRoot>,
        );

        // Sanity — root nav has only the "root" entry; home tab's inner
        // nav was minted and exposes a `parent` pointing at root.
        expect(rootProbe.nav!.stack.length).toBe(1);
        expect(rootProbe.nav!.current.route).toBe('root');
        expect(homeProbe.nav).not.toBe(null);
        expect(homeProbe.nav!.parent).toBe(rootProbe.nav);

        act(() => homeProbe.nav!.push('settings'));

        // Inner home stack grew by one entry; root is untouched.
        expect(homeProbe.nav!.stack.length).toBe(2);
        expect(homeProbe.nav!.current.route).toBe('settings');
        expect(rootProbe.nav!.stack.length).toBe(1);
        expect(rootProbe.nav!.current.route).toBe('root');
    });

    it('modal push from inside a tab escalates to root', async () => {
        const { rs, homeProbe } = makeProbedRoutes();
        const RootTabs = makeRootTabs();
        const rootProbe: NavProbe = { nav: null };
        const rsWithTabs = { ...rs, root: { component: RootTabs } } as never;

        render(
            <NavigationRoot
                routes={rsWithTabs}
                initialRoute={'root' as never}
                animated={false}
            >
                <Capture probe={rootProbe} />
                <Stack />
            </NavigationRoot>,
        );

        // composeMessage is `presentation: 'modal'` in the fixture — pushing
        // it from inside the home tab should leave home's inner stack alone
        // and append onto root.
        act(() =>
            homeProbe.nav!.push('composeMessage', { recipientId: 'u_99' }),
        );

        expect(homeProbe.nav!.stack.length).toBe(1);
        expect(rootProbe.nav!.stack.length).toBe(2);
        expect(rootProbe.nav!.current.route).toBe('composeMessage');
        expect(rootProbe.nav!.current.presentation).toBe('modal');
    });

    it('modal push via options.presentation override also escalates', async () => {
        const { rs, homeProbe } = makeProbedRoutes();
        const RootTabs = makeRootTabs();
        const rootProbe: NavProbe = { nav: null };
        const rsWithTabs = { ...rs, root: { component: RootTabs } } as never;

        render(
            <NavigationRoot
                routes={rsWithTabs}
                initialRoute={'root' as never}
                animated={false}
            >
                <Capture probe={rootProbe} />
                <Stack />
            </NavigationRoot>,
        );

        // `settings` is `card` by default; force it via options to verify
        // the escalation decision honors per-call overrides (same code path
        // that `<Link>` and `useLinkingNav` go through eventually).
        act(() =>
            // `settings` has no params schema → push signature is
            // (name, search?, options?). Pass options in slot 3.
            homeProbe.nav!.push('settings', undefined, {
                presentation: 'modal',
            }),
        );

        expect(homeProbe.nav!.stack.length).toBe(1);
        expect(rootProbe.nav!.stack.length).toBe(2);
        expect(rootProbe.nav!.current.route).toBe('settings');
        expect(rootProbe.nav!.current.presentation).toBe('modal');
    });

    it('replace stays strictly local even for modal-presentation routes', async () => {
        const { rs, homeProbe } = makeProbedRoutes();
        const RootTabs = makeRootTabs();
        const rootProbe: NavProbe = { nav: null };
        const rsWithTabs = { ...rs, root: { component: RootTabs } } as never;

        render(
            <NavigationRoot
                routes={rsWithTabs}
                initialRoute={'root' as never}
                animated={false}
            >
                <Capture probe={rootProbe} />
                <Stack />
            </NavigationRoot>,
        );

        // Use replace on a modal-presentation route from inside a tab. If
        // replace ever started "escalating" the way push does, this would
        // wipe root's stack ([root] → [composeMessage]) which destroys the
        // entire app shell. Locking in that replace never escalates.
        const rootStackBefore = rootProbe.nav!.stack.length;
        const homeStackBefore = homeProbe.nav!.stack.length;
        act(() =>
            homeProbe.nav!.replace('composeMessage', { recipientId: 'u_1' }),
        );

        // Root untouched.
        expect(rootProbe.nav!.stack.length).toBe(rootStackBefore);
        expect(rootProbe.nav!.current.route).toBe('root');
        // Inner stack length unchanged (replace = swap top), top is now
        // composeMessage *inside the tab*. Visual result depends on the
        // host, but the model state is what we lock here.
        expect(homeProbe.nav!.stack.length).toBe(homeStackBefore);
        expect(homeProbe.nav!.current.route).toBe('composeMessage');
    });

    it('root nav.parent is null; nested nav.parent points at root', async () => {
        const { rs, homeProbe } = makeProbedRoutes();
        const RootTabs = makeRootTabs();
        const rootProbe: NavProbe = { nav: null };
        const rsWithTabs = { ...rs, root: { component: RootTabs } } as never;

        render(
            <NavigationRoot
                routes={rsWithTabs}
                initialRoute={'root' as never}
                animated={false}
            >
                <Capture probe={rootProbe} />
                <Stack />
            </NavigationRoot>,
        );

        expect(rootProbe.nav!.parent).toBe(null);
        expect(homeProbe.nav!.parent).toBe(rootProbe.nav);
    });

    it('nested nav registers under parent._children and unregisters on unmount', async () => {
        const { rs, homeProbe } = makeProbedRoutes();
        const RootTabs = makeRootTabs();
        const rootProbe: NavProbe = { nav: null };
        const rsWithTabs = { ...rs, root: { component: RootTabs } } as never;

        const handle = render(
            <NavigationRoot
                routes={rsWithTabs}
                initialRoute={'root' as never}
                animated={false}
            >
                <Capture probe={rootProbe} />
                <Stack />
            </NavigationRoot>,
        );

        // All three tabs' nested stacks should be registered as children of
        // root — this is what `useHardwareBack` traverses to find the
        // currently-focused nav.
        expect(rootProbe.nav!._children.size).toBe(3);
        expect(rootProbe.nav!._children.has(homeProbe.nav!)).toBe(true);

        // After unmount the nested navs should remove themselves from
        // parent._children — leaks here would gradually break the
        // hardware-back traversal across navigations.
        const rootNav = rootProbe.nav!;
        handle.unmount();
        expect(rootNav._children.size).toBe(0);
    });

    it('useIsFocused inside an inactive tab reports false', async () => {
        // Custom Profile screen that captures its own focus state so the
        // assertion is independent of routes' `useParams` schema validity.
        const focusProbe: FocusProbe = { focused: null };
        const ProfileWithFocus = component(() => () => (
            <view>
                <FocusCapture probe={focusProbe} />
                <text>ProfileFocus</text>
            </view>
        ));

        const rsBase = {
            home: { component: Home },
            profile: { ...routes.profile, component: ProfileWithFocus },
            settings: { component: Settings },
            composeMessage: routes.composeMessage,
        } as typeof routes;

        const RootTabs = component(() => () => (
            <Tabs initialTab="home">
                <Tabs.Screen name="home"><Stack initialRoute="home" /></Tabs.Screen>
                <Tabs.Screen name="profile">
                    <Stack
                        initialRoute="profile"
                        initialParams={{ id: 'demo' }}
                        initialSearch={{ tab: 'posts' }}
                    />
                </Tabs.Screen>
            </Tabs>
        ));

        const rsWithTabs = { ...rsBase, root: { component: RootTabs } } as never;
        const rootProbe: NavProbe = { nav: null };
        // Profile screen body is mounted from the start (tab bodies stay
        // mounted via display: none), so focus probe is set up immediately.
        render(
            <NavigationRoot
                routes={rsWithTabs}
                initialRoute={'root' as never}
                animated={false}
            >
                <Capture probe={rootProbe} />
                <Stack />
            </NavigationRoot>,
        );

        // Home tab is active — profile is mounted-but-hidden, so its focus
        // probe must report false. The positive direction (flips on
        // `tabs.setActive`) is exercised by the existing
        // `tabs.test.tsx::setActive` test combined with the focus chain
        // wired up here.
        expect(focusProbe.focused).not.toBe(null);
        expect(focusProbe.focused!.value).toBe(false);
    });
});
