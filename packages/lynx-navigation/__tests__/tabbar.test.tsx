/**
 * Runtime tests for `<TabBar>`.
 *
 * Verifies:
 *  - Default chrome renders one button per `<Tabs.Screen>` in registration
 *    order, using `label ?? name`.
 *  - The active tab is reflected via the `active` prop on the default
 *    button — checked here via the `opacity:1` style (inactive is 0.6).
 *  - Tapping a default button switches the active tab.
 *  - `accessibilityLabel` overrides `label` for the a11y attribute, with
 *    `label` and finally `name` as fallbacks.
 *  - `renderTab` fully replaces the default button rendering.
 *  - The bar updates reactively when `<Tabs.Screen>` set unmounts.
 */
import { describe, expect, it } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot.js';
import { Tabs } from '../src/components/Tabs.js';
import { TabBar, type TabRenderContext } from '../src/components/TabBar.js';
import type { TabInfo } from '../src/components/Tabs.js';
import { routes } from './_fixtures.js';

function findTappable(node: any): any {
    let n = node;
    while (n && !(n.props && n.props.bindtap)) n = n.parent;
    return n;
}

describe('<TabBar> default chrome', () => {
    it('renders one button per registered tab with label fallback to name', () => {
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabBar />
                    <Tabs.Screen name="feed" label="Feed"><view /></Tabs.Screen>
                    <Tabs.Screen name="me"><view /></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );
        expect(result.queryByText('Feed')).not.toBeNull();
        // No `label` prop on the second screen → falls back to `name`.
        expect(result.queryByText('me')).not.toBeNull();
        result.unmount();
    });

    it('switches active tab on tap', () => {
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabBar />
                    <Tabs.Screen name="feed" label="Feed"><view><text>FeedBody</text></view></Tabs.Screen>
                    <Tabs.Screen name="me" label="Me"><view><text>MeBody</text></view></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );
        // Initial: feed active (first registered). The Me button is dimmed.
        const meBtn = findTappable(result.getByText('Me'));
        expect(meBtn).toBeTruthy();
        expect(meBtn.props.style.opacity).toBe(0.6);

        act(() => meBtn.props.bindtap());

        const meBtn2 = findTappable(result.getByText('Me'));
        expect(meBtn2.props.style.opacity).toBe(1);
        const feedBtn = findTappable(result.getByText('Feed'));
        expect(feedBtn.props.style.opacity).toBe(0.6);
        result.unmount();
    });

    it('uses accessibilityLabel over label for the a11y attribute', () => {
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabBar />
                    <Tabs.Screen
                        name="feed"
                        label="Feed"
                        accessibilityLabel="Activity feed"
                    >
                        <view />
                    </Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );
        const btn = findTappable(result.getByText('Feed'));
        expect(btn.props['accessibility-label']).toBe('Activity feed');
        result.unmount();
    });

    it('falls back accessibility-label through label → name', () => {
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabBar />
                    <Tabs.Screen name="me"><view /></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );
        const btn = findTappable(result.getByText('me'));
        expect(btn.props['accessibility-label']).toBe('me');
        result.unmount();
    });
});

describe('<TabBar> renderTab override', () => {
    it('renders custom content from renderTab instead of the default button', () => {
        const renderTab = (info: TabInfo, ctx: TabRenderContext) => (
            <view bindtap={() => ctx.onPress()}>
                <text>{`custom:${info.name}:${ctx.active ? 'on' : 'off'}`}</text>
            </view>
        );
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabBar renderTab={renderTab} />
                    <Tabs.Screen name="feed"><view /></Tabs.Screen>
                    <Tabs.Screen name="me"><view /></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );
        expect(result.queryByText('custom:feed:on')).not.toBeNull();
        expect(result.queryByText('custom:me:off')).not.toBeNull();

        const meBtn = findTappable(result.getByText('custom:me:off'));
        act(() => meBtn.props.bindtap());

        expect(result.queryByText('custom:feed:off')).not.toBeNull();
        expect(result.queryByText('custom:me:on')).not.toBeNull();
        result.unmount();
    });
});

describe('<TabBar> reactivity', () => {
    it('updates when a <Tabs.Screen> unmounts', () => {
        const showSecond = signal({ value: true });
        const App = component(() => () => (
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabBar />
                    <Tabs.Screen name="feed" label="Feed"><view /></Tabs.Screen>
                    {showSecond.value
                        ? <Tabs.Screen name="me" label="Me"><view /></Tabs.Screen>
                        : null}
                </Tabs>
            </NavigationRoot>
        ));
        const result = render(<App />);
        expect(result.queryByText('Me')).not.toBeNull();

        act(() => { showSecond.value = false; });

        expect(result.queryByText('Me')).toBeNull();
        expect(result.queryByText('Feed')).not.toBeNull();
        result.unmount();
    });
});
