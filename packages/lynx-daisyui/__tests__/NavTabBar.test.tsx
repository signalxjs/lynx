/**
 * Runtime tests for `<NavTabBar>` — standalone mode (#210) and the
 * navigator-driven mode it must not regress.
 *
 * Press dispatch is asserted through `renderTab`'s `ctx.onPress` rather
 * than synthetic taps: the default chrome presses via the gesture-driven
 * `<Pressable>` (MT recognizer), which the BG test harness can't drive,
 * while `ctx.onPress` is exactly the handler the default chrome invokes.
 */
import { describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import {
    NavigationRoot,
    Tabs,
    defineRoutes,
    useTabs,
    type TabInfo,
    type TabsNav,
} from '@sigx/lynx-navigation';
import { NavTabBar } from '../src/navigation/NavTabBar';

const ITEMS: TabInfo[] = [
    { name: 'home', label: 'Home' },
    { name: 'search', label: 'Search' },
    { name: 'me', label: 'Profile' },
];

/** Depth-first search over the TestNode tree (same shape as other daisyui tests). */
function findNode(root: any, pred: (n: any) => boolean): any {
    const stack: any[] = [root];
    while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        if (pred(node)) return node;
        for (const k of node.children ?? []) stack.push(k);
    }
    return null;
}

describe('<NavTabBar> standalone mode', () => {
    it('renders explicit items without a <Tabs> ancestor', () => {
        const result = render(<NavTabBar items={ITEMS} />);
        expect(result.queryByText('Home')).not.toBeNull();
        expect(result.queryByText('Search')).not.toBeNull();
        expect(result.queryByText('Profile')).not.toBeNull();
        result.unmount();
    });

    it('falls back to name when an item has no label', () => {
        const result = render(<NavTabBar items={[{ name: 'inbox' }]} />);
        expect(result.queryByText('inbox')).not.toBeNull();
        result.unmount();
    });

    it('highlights the activeId item and dims the rest', () => {
        const result = render(<NavTabBar items={ITEMS} activeId="search" />);
        // getByText returns the raw #text node; the classed <text> element is its parent.
        const activeLabel = result.getByText('Search').parent!;
        expect(activeLabel._class).toContain('text-primary');
        expect(activeLabel._class).toContain('font-semibold');
        const inactiveLabel = result.getByText('Home').parent!;
        expect(inactiveLabel._class).not.toContain('text-primary');
        expect(inactiveLabel._class).toContain('opacity-60');
        result.unmount();
    });

    it('highlights nothing when activeId is unset', () => {
        const result = render(<NavTabBar items={ITEMS} />);
        const highlighted = findNode(
            result.container,
            (n) => typeof n._class === 'string' && n._class.includes('text-primary'),
        );
        expect(highlighted).toBeNull();
        result.unmount();
    });

    it('reports presses via onSelect', () => {
        const onSelect = vi.fn();
        const press: Record<string, () => void> = {};
        const result = render(
            <NavTabBar
                items={ITEMS}
                activeId="home"
                onSelect={onSelect}
                renderTab={(info, ctx) => {
                    press[info.name] = ctx.onPress;
                    return <text>{info.label}</text>;
                }}
            />,
        );
        act(() => press['me']());
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('me');
        result.unmount();
    });
});

// ── Navigator mode (regression) ────────────────────────────────────────────

const Home = component(() => () => <view><text>HomeRoute</text></view>);
const routes = defineRoutes({ home: { component: Home } });

interface TabsProbe { nav: TabsNav | null }
const TabsCapture = component<{ probe: TabsProbe } & {}>(({ props }) => {
    const nav = useTabs();
    props.probe.nav = nav;
    return () => null;
});

describe('<NavTabBar> navigator mode', () => {
    it('renders registered tabs and setActive flows through ctx.onPress', () => {
        const probe: TabsProbe = { nav: null };
        const onSelect = vi.fn();
        const press: Record<string, () => void> = {};
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Tabs>
                    <TabsCapture probe={probe} />
                    <NavTabBar
                        onSelect={onSelect}
                        renderTab={(info, ctx) => {
                            press[info.name] = ctx.onPress;
                            return <text>{info.label ?? info.name}</text>;
                        }}
                    />
                    <Tabs.Screen name="feed" label="Feed"><view /></Tabs.Screen>
                    <Tabs.Screen name="me" label="Me"><view /></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );

        expect(result.queryByText('Feed')).not.toBeNull();
        expect(result.queryByText('Me')).not.toBeNull();
        expect(probe.nav!.active).toBe('feed');

        act(() => press['me']());
        expect(probe.nav!.active).toBe('me');
        // The select event fires in navigator mode too.
        expect(onSelect).toHaveBeenCalledWith('me');
        result.unmount();
    });
});
