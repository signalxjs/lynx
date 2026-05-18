/**
 * Runtime tests for `<Drawer>` and `useDrawer`.
 *
 * Verifies:
 *  - Drawer starts closed by default; `initialOpen` opens at mount.
 *  - `useDrawer().open()` / `close()` / `toggle()` reactively flip
 *    `isOpen` and update the sidebar's `display` style.
 *  - The `sidebar` slot prop fills the overlay; default children render
 *    as the main content (always visible).
 *  - `useDrawer()` throws when called outside a `<Drawer>`.
 */
import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Drawer, useDrawer, type DrawerNav } from '../src/components/Drawer';
import { routes } from './_fixtures';

interface Probe { nav: DrawerNav | null }

const Capture = component<{ probe: Probe } & {}>(({ props }) => {
    const nav = useDrawer();
    props.probe.nav = nav;
    return () => null;
});

function findSidebarOverlay(result: any): any {
    const root = result.container ?? result.root ?? result;
    const stack: any[] = [root];
    while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        const s = node.props?.style;
        if (s && s.position === 'absolute' && s.left === 0) return node;
        const kids = node.children ?? [];
        for (const k of kids) stack.push(k);
    }
    return null;
}

describe('<Drawer>', () => {
    it('starts closed and hides the sidebar', () => {
        const probe: Probe = { nav: null };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Drawer slots={{ sidebar: () => <view><text>SidebarBody</text></view> }}>
                    <Capture probe={probe} />
                    <view><text>ContentBody</text></view>
                </Drawer>
            </NavigationRoot>,
        );
        expect(probe.nav!.isOpen).toBe(false);
        const overlay = findSidebarOverlay(result);
        expect(overlay).toBeTruthy();
        expect(overlay.props.style.display).toBe('none');
        expect(result.queryByText('ContentBody')).not.toBeNull();
        result.unmount();
    });

    it('starts open when initialOpen is true', () => {
        const probe: Probe = { nav: null };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Drawer initialOpen slots={{ sidebar: () => <view><text>SidebarBody</text></view> }}>
                    <Capture probe={probe} />
                    <view><text>ContentBody</text></view>
                </Drawer>
            </NavigationRoot>,
        );
        expect(probe.nav!.isOpen).toBe(true);
        const overlay = findSidebarOverlay(result);
        expect(overlay.props.style.display).toBe('flex');
        result.unmount();
    });

    it('open() / close() / toggle() update isOpen reactively', () => {
        const probe: Probe = { nav: null };
        const result = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Drawer slots={{ sidebar: () => <view><text>S</text></view> }}>
                    <Capture probe={probe} />
                    <view><text>C</text></view>
                </Drawer>
            </NavigationRoot>,
        );
        expect(probe.nav!.isOpen).toBe(false);

        act(() => probe.nav!.open());
        expect(probe.nav!.isOpen).toBe(true);
        expect(findSidebarOverlay(result).props.style.display).toBe('flex');

        act(() => probe.nav!.close());
        expect(probe.nav!.isOpen).toBe(false);
        expect(findSidebarOverlay(result).props.style.display).toBe('none');

        act(() => probe.nav!.toggle());
        expect(probe.nav!.isOpen).toBe(true);
        act(() => probe.nav!.toggle());
        expect(probe.nav!.isOpen).toBe(false);

        result.unmount();
    });

    it('useDrawer() throws outside a <Drawer> component', () => {
        const Bad = component(() => {
            useDrawer();
            return () => null;
        });
        expect(() => render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Bad />
            </NavigationRoot>,
        )).toThrowError(/useDrawer\(\) called outside/);
    });
});
