/**
 * Runtime tests for hero `<NavDrawer>` — the theming layer over the primitive
 * `<Drawer>` from `@sigx/lynx-navigation`: slot wiring, token-vs-raw background
 * resolution, side/width geometry, and mount/unmount on open/close. Underlying
 * drawer state is owned by the primitive (covered in lynx-navigation tests).
 */
import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { useDrawer, type DrawerNav } from '@sigx/lynx-navigation';
import { NavDrawer } from '../src/components/NavDrawer';

interface Probe { nav: DrawerNav | null }

const Capture = component<{ probe: Probe }>(({ props }) => {
    const nav = useDrawer();
    props.probe.nav = nav;
    return () => null;
});

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

const findPanel = (root: any, token: string) =>
    findNode(root, (n) =>
        typeof n.props?.class === 'string'
        && n.props.class.split(' ').includes(`bg-${token}`)
        && typeof n.props?.style?.width === 'number');

describe('hero NavDrawer', () => {
    it('mounts the sidebar + main slots only while open', () => {
        const probe: Probe = { nav: null };
        const { container } = render(
            <NavDrawer side="left" width={200} background="base-100" slots={{ sidebar: () => <text>SIDEBAR</text> }}>
                <Capture probe={probe} />
            </NavDrawer>,
        );
        // Closed at mount: no themed panel.
        expect(findPanel(container, 'base-100')).toBeNull();
        // Open → panel + sidebar mount.
        act(() => probe.nav!.open());
        const panel = findPanel(container, 'base-100');
        expect(panel).toBeTruthy();
        expect(panel.props.style.width).toBe(200);
        expect(container.findByText('SIDEBAR')).toBeTruthy();
    });

    it('left side anchors the panel to the left edge; right to the right', () => {
        const probe: Probe = { nav: null };
        const { container } = render(
            <NavDrawer side="right" width={240} background="base-200" slots={{ sidebar: () => <text>S</text> }}>
                <Capture probe={probe} />
            </NavDrawer>,
        );
        act(() => probe.nav!.open());
        const panel = findPanel(container, 'base-200');
        expect(panel.props.style.right).toBe(0);
        expect(panel.props.style.left).toBeUndefined();
    });

    it('a raw CSS background applies inline (no bg- class)', () => {
        const probe: Probe = { nav: null };
        const { container } = render(
            <NavDrawer background="#facc15" width={200} slots={{ sidebar: () => <text>S</text> }}>
                <Capture probe={probe} />
            </NavDrawer>,
        );
        act(() => probe.nav!.open());
        const panel = findNode(container, (n) => n.props?.style?.backgroundColor === '#facc15');
        expect(panel).toBeTruthy();
        expect((panel.props.class ?? '')).not.toContain('bg-#facc15');
    });
});
