/**
 * Runtime tests for `<Header>` and `useScreenOptions`.
 *
 * Verifies:
 *  - Default header renders the focused entry's `options.title`.
 *  - Back button appears only when `nav.canGoBack` is true; tapping it pops.
 *  - `<Screen.Header>` slot fill fully replaces the default chrome.
 *  - `<Screen.HeaderLeft>` / `<Screen.HeaderRight>` slot fills are rendered
 *    in the default layout's left/right positions.
 *  - `headerShown: false` hides the header entirely.
 *  - `useScreenOptions(getter)` updates the title reactively.
 *  - Switching focused entry (push) swaps the header content to the new
 *    entry's registry — the `<Header>` is mounted once.
 */
import { describe, expect, it } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { useNav } from '../src/hooks/use-nav.js';
import { NavigationRoot } from '../src/components/NavigationRoot.js';
import { Stack } from '../src/components/Stack.js';
import { Screen } from '../src/components/Screen.js';
import { Header } from '../src/components/Header.js';
import { useScreenOptions } from '../src/hooks/use-screen-options.js';
import { routes } from './_fixtures.js';

interface NavProbe { nav: ReturnType<typeof useNav> | null }

const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    const nav = useNav();
    props.probe.nav = nav;
    return () => null;
});

function findTappable(node: any): any {
    // Walk up to a node that has bindtap (the `<view>` wrapping the back button).
    let n = node;
    while (n && !(n.props && n.props.bindtap)) n = n.parent;
    return n;
}

describe('<Header> default layout', () => {
    it('renders the focused entry title', () => {
        const Home = component(() => () => (
            <Screen title="Welcome"><view><text>HomeBody</text></view></Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('Welcome')).not.toBeNull();
        result.unmount();
    });

    it('falls back to the route name when no title is set', () => {
        const Home = component(() => () => (
            <Screen><view /></Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('home')).not.toBeNull();
        result.unmount();
    });

    it('shows a back button only when canGoBack is true', () => {
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
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('‹ Back')).toBeNull();

        act(() => { probe.nav!.push('settings'); });
        expect(result.queryByText('‹ Back')).not.toBeNull();
        expect(result.queryByText('Settings')).not.toBeNull();

        // Tap back — should pop and hide the button again.
        const tappable = findTappable(result.getByText('‹ Back'));
        expect(tappable).toBeTruthy();
        act(() => tappable.props.bindtap());
        expect(result.queryByText('‹ Back')).toBeNull();
        expect(result.queryByText('Home')).not.toBeNull();

        result.unmount();
    });

    it('hides the header when headerShown is false', () => {
        const Home = component(() => () => (
            <Screen title="Hidden" headerShown={false}><view /></Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('Hidden')).toBeNull();
        result.unmount();
    });
});

describe('<Header> slot fills', () => {
    it('`<Screen.Header>` overrides the default chrome entirely', () => {
        const Home = component(() => () => (
            <Screen title="ShouldNotShow">
                <Screen.Header><text>FullCustom</text></Screen.Header>
                <view />
            </Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('FullCustom')).not.toBeNull();
        expect(result.queryByText('ShouldNotShow')).toBeNull();
        result.unmount();
    });

    it('renders headerLeft / headerRight fills in the default layout', () => {
        const Home = component(() => () => (
            <Screen title="Mid">
                <Screen.HeaderLeft><text>LSlot</text></Screen.HeaderLeft>
                <Screen.HeaderRight><text>RSlot</text></Screen.HeaderRight>
                <view />
            </Screen>
        ));
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('LSlot')).not.toBeNull();
        expect(result.queryByText('Mid')).not.toBeNull();
        expect(result.queryByText('RSlot')).not.toBeNull();
        result.unmount();
    });
});

describe('useScreenOptions', () => {
    it('reactively updates the header title via getter', () => {
        const title = signal({ value: 'First' });
        const Home = component(() => {
            useScreenOptions(() => ({ title: title.value }));
            return () => <view><text>HomeBody</text></view>;
        });
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('First')).not.toBeNull();
        act(() => { title.value = 'Second'; });
        expect(result.queryByText('Second')).not.toBeNull();
        expect(result.queryByText('First')).toBeNull();
        result.unmount();
    });

    it('merges static options when passed a plain object', () => {
        const Home = component(() => {
            useScreenOptions({ title: 'Static' });
            return () => <view />;
        });
        const localRoutes = { ...routes, home: { component: Home } } as typeof routes;
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('Static')).not.toBeNull();
        result.unmount();
    });
});

describe('<Header> follows focused entry', () => {
    it('swaps content when nav.push changes the focused entry', () => {
        const Home = component(() => () => <Screen title="H1"><view /></Screen>);
        const Settings = component(() => () => <Screen title="S2"><view /></Screen>);
        const localRoutes = {
            ...routes,
            home: { component: Home },
            settings: { component: Settings },
        } as typeof routes;
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Header />
                <Stack />
            </NavigationRoot>,
        );
        expect(result.queryByText('H1')).not.toBeNull();
        expect(result.queryByText('S2')).toBeNull();

        act(() => { probe.nav!.push('settings'); });
        expect(result.queryByText('S2')).not.toBeNull();
        expect(result.queryByText('H1')).toBeNull();

        result.unmount();
    });
});
