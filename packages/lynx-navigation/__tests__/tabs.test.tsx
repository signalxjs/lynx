/**
 * Runtime tests for `<Tabs>` and `<Tabs.Screen>`.
 *
 * Verifies:
 *  - First registered `<Tabs.Screen>` is active by default; explicit
 *    `initialTab` wins over registration order.
 *  - `useTabs().setActive(name)` switches active reactively.
 *  - All tab bodies stay mounted across switches (per-tab state
 *    preservation) — inactive ones hide via `display: 'none'` rather than
 *    unmount.
 *  - `useTabs()` throws when called outside a `<Tabs>` ancestor.
 *  - `<Tabs.Screen>` cleans up its registration on unmount.
 */
import { describe, expect, it } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Tabs, useTabs, type TabsNav } from '../src/components/Tabs';
import { routes } from './_fixtures';

interface TabsProbe {
    nav: TabsNav | null;
}

const TabsCapture = component<{ probe: TabsProbe } & {}>(({ props }) => {
    const nav = useTabs();
    props.probe.nav = nav;
    return () => null;
});

describe('<Tabs>', () => {
    it('activates the first registered tab by default', () => {
        const probe: TabsProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabsCapture probe={probe} />
                    <Tabs.Screen name="feed"><view><text>FeedBody</text></view></Tabs.Screen>
                    <Tabs.Screen name="me"><view><text>MeBody</text></view></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );

        expect(probe.nav!.active).toBe('feed');
        expect(probe.nav!.tabs.map((t) => t.name)).toEqual(['feed', 'me']);
    });

    it('respects an explicit initialTab over registration order', () => {
        const probe: TabsProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs initialTab="me">
                    <TabsCapture probe={probe} />
                    <Tabs.Screen name="feed"><view /></Tabs.Screen>
                    <Tabs.Screen name="me"><view /></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );

        expect(probe.nav!.active).toBe('me');
    });

    it('switches active tab reactively via setActive', () => {
        const probe: TabsProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabsCapture probe={probe} />
                    <Tabs.Screen name="feed"><view /></Tabs.Screen>
                    <Tabs.Screen name="me"><view /></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );

        expect(probe.nav!.active).toBe('feed');
        act(() => probe.nav!.setActive('me'));
        expect(probe.nav!.active).toBe('me');
    });

    it('keeps all tab bodies mounted across switches (state preservation)', () => {
        // Each tab body increments its own setup counter. If the body re-runs
        // setup, the counter would jump on switch-back — proving an unmount.
        // Plain mutable closure vars, not signals — reading + writing a
        // signal in setup is itself a tracked loop and isn't what we want
        // to measure here.
        const counters = { feed: 0, me: 0 };

        const FeedBody = component(() => {
            counters.feed += 1;
            return () => <view><text>FeedBody</text></view>;
        });
        const MeBody = component(() => {
            counters.me += 1;
            return () => <view><text>MeBody</text></view>;
        });

        const probe: TabsProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabsCapture probe={probe} />
                    <Tabs.Screen name="feed"><FeedBody /></Tabs.Screen>
                    <Tabs.Screen name="me"><MeBody /></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );

        // Both bodies mounted exactly once at initial render.
        expect(counters.feed).toBe(1);
        expect(counters.me).toBe(1);

        act(() => probe.nav!.setActive('me'));
        act(() => probe.nav!.setActive('feed'));
        act(() => probe.nav!.setActive('me'));

        // Still exactly one setup each — bodies were hidden, not unmounted.
        expect(counters.feed).toBe(1);
        expect(counters.me).toBe(1);
    });

    it('unregisters a tab when its <Tabs.Screen> unmounts', () => {
        const showSecond = signal({ value: true });
        const probe: TabsProbe = { nav: null };
        const App = component(() => () => (
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabsCapture probe={probe} />
                    <Tabs.Screen name="feed"><view /></Tabs.Screen>
                    {showSecond.value ? <Tabs.Screen name="me"><view /></Tabs.Screen> : null}
                </Tabs>
            </NavigationRoot>
        ));

        render(<App />);
        expect(probe.nav!.tabs.map((t) => t.name)).toEqual(['feed', 'me']);

        act(() => { showSecond.value = false; });
        expect(probe.nav!.tabs.map((t) => t.name)).toEqual(['feed']);
    });

    it('throws when useTabs() is called outside a <Tabs> ancestor', () => {
        const probe: TabsProbe = { nav: null };
        expect(() =>
            render(
                <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                    <TabsCapture probe={probe} />
                </NavigationRoot>,
            ),
        ).toThrow(/useTabs\(\) called outside/);
    });
});
