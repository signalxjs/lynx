/**
 * Runtime tests for `<NavDrawer>` — the daisy-themed wrapper over the
 * primitive `<Drawer>` from `@sigx/lynx-navigation`.
 *
 * Verifies the theming layer specifically — slot wiring, daisy background
 * resolution, side/width geometry, and mount/unmount on open/close.
 * Underlying state behavior (initialOpen, toggle, etc.) is owned by the
 * primitive and covered by `lynx-navigation/__tests__/drawer.test.tsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { useDrawer, type DrawerNav } from '@sigx/lynx-navigation';
import { NavDrawer } from '../src/navigation/NavDrawer';

interface Probe { nav: DrawerNav | null }

const Capture = component<{ probe: Probe } & {}>(({ props }) => {
    const nav = useDrawer();
    props.probe.nav = nav;
    return () => null;
});

/**
 * Walk the rendered tree and return the first node matching a predicate.
 * The TestNode shape is shared across all daisyui tests but doesn't expose
 * a typed traversal API for class/style search.
 */
function findNode(root: any, pred: (n: any) => boolean): any {
    const stack: any[] = [root];
    while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        if (pred(node)) return node;
        const kids = node.children ?? [];
        for (const k of kids) stack.push(k);
    }
    return null;
}

/**
 * Locate the themed panel — the absolute view sized to `width` carrying
 * the daisy `bg-<token>` Tailwind class.
 */
function findPanel(root: any, token: string): any {
    const cls = `bg-${token}`;
    return findNode(root, (n) =>
        typeof n.props?.class === 'string'
        && n.props.class.split(' ').includes(cls)
        && typeof n.props?.style?.width === 'number',
    );
}

/**
 * Locate the backdrop — the absolute scrim carrying `bg-base-content`
 * and `opacity: 0`. The opacity gate disambiguates the backdrop from
 * any other view that happens to share the class.
 */
function findBackdrop(root: any): any {
    return findNode(root, (n) =>
        typeof n.props?.class === 'string'
        && n.props.class.split(' ').includes('bg-base-content')
        && n.props?.style?.opacity === 0,
    );
}

describe('<NavDrawer>', () => {
    it('renders default content always, sidebar only when open', () => {
        const result = render(
            <NavDrawer initialOpen slots={{ sidebar: () => <view><text>SidebarBody</text></view> }}>
                <view><text>ContentBody</text></view>
            </NavDrawer>,
        );
        expect(result.queryByText('ContentBody')).not.toBeNull();
        expect(result.queryByText('SidebarBody')).not.toBeNull();
        result.unmount();
    });

    it('omits the sidebar entirely when closed (no display:none leftover)', () => {
        const result = render(
            <NavDrawer slots={{ sidebar: () => <view><text>SidebarBody</text></view> }}>
                <view><text>ContentBody</text></view>
            </NavDrawer>,
        );
        expect(result.queryByText('ContentBody')).not.toBeNull();
        expect(result.queryByText('SidebarBody')).toBeNull();
        result.unmount();
    });

    it('applies default base-100 surface, left-side border + position, 280px width', () => {
        const result = render(
            <NavDrawer initialOpen slots={{ sidebar: () => <view><text>S</text></view> }}>
                <view><text>C</text></view>
            </NavDrawer>,
        );
        const panel = findPanel(result.container, 'base-100');
        expect(panel).not.toBeNull();
        expect(panel.props.class).toContain('border-r border-base-300');
        expect(panel.props.style.width).toBe(280);
        expect(panel.props.style.left).toBe(0);
        expect(panel.props.style.right).toBeUndefined();
        result.unmount();
    });

    it('applies an arbitrary daisy token as the bg-<token> Tailwind class', () => {
        const result = render(
            <NavDrawer
                initialOpen
                background="primary"
                slots={{ sidebar: () => <view><text>S</text></view> }}
            >
                <view><text>C</text></view>
            </NavDrawer>,
        );
        const panel = findPanel(result.container, 'primary');
        expect(panel).not.toBeNull();
        // Daisy tokens go through the CSS pipeline, not inline — Lynx
        // only resolves `var(--color-*)` from compiled rules.
        expect(panel.props.style.backgroundColor).toBeUndefined();
        result.unmount();
    });

    it('passes a raw CSS color through as an inline backgroundColor', () => {
        const result = render(
            <NavDrawer
                initialOpen
                background="#facc15"
                slots={{ sidebar: () => <view><text>S</text></view> }}
            >
                <view><text>C</text></view>
            </NavDrawer>,
        );
        const panel = findNode(result.container, (n) =>
            n.props?.style?.backgroundColor === '#facc15',
        );
        expect(panel).not.toBeNull();
        // Raw colors don't have a `bg-<value>` class — only inline.
        expect(panel.props.class).not.toContain('bg-#');
        result.unmount();
    });

    it('respects custom width and bordered=false', () => {
        const result = render(
            <NavDrawer
                initialOpen
                background="base-300"
                width={320}
                bordered={false}
                slots={{ sidebar: () => <view><text>S</text></view> }}
            >
                <view><text>C</text></view>
            </NavDrawer>,
        );
        const panel = findPanel(result.container, 'base-300');
        expect(panel).not.toBeNull();
        expect(panel.props.class).not.toContain('border-r');
        expect(panel.props.class).not.toContain('border-l');
        expect(panel.props.style.width).toBe(320);
        result.unmount();
    });

    it('flips position + border to the right edge when side="right"', () => {
        const result = render(
            <NavDrawer
                initialOpen
                side="right"
                slots={{ sidebar: () => <view><text>S</text></view> }}
            >
                <view><text>C</text></view>
            </NavDrawer>,
        );
        const panel = findPanel(result.container, 'base-100');
        expect(panel).not.toBeNull();
        expect(panel.props.style.right).toBe(0);
        expect(panel.props.style.left).toBeUndefined();
        expect(panel.props.class).toContain('border-l border-base-300');
        expect(panel.props.class).not.toContain('border-r');
        result.unmount();
    });

    it('omits the backdrop when closed', () => {
        const result = render(
            <NavDrawer slots={{ sidebar: () => <view><text>S</text></view> }}>
                <view><text>C</text></view>
            </NavDrawer>,
        );
        expect(findBackdrop(result.container)).toBeNull();
        result.unmount();
    });

    it('renders the backdrop when initialOpen is true', () => {
        const result = render(
            <NavDrawer initialOpen slots={{ sidebar: () => <view><text>S</text></view> }}>
                <view><text>C</text></view>
            </NavDrawer>,
        );
        expect(findBackdrop(result.container)).not.toBeNull();
        result.unmount();
    });

    it('omits the backdrop entirely when backdrop=false', () => {
        const result = render(
            <NavDrawer
                initialOpen
                backdrop={false}
                slots={{ sidebar: () => <view><text>S</text></view> }}
            >
                <view><text>C</text></view>
            </NavDrawer>,
        );
        expect(findBackdrop(result.container)).toBeNull();
        result.unmount();
    });

    it('mounts panel + backdrop on open, unmounts on close after exit animation', () => {
        vi.useFakeTimers();
        try {
            const probe: Probe = { nav: null };
            const result = render(
                <NavDrawer slots={{ sidebar: () => <view><text>SidebarBody</text></view> }}>
                    <Capture probe={probe} />
                    <view><text>C</text></view>
                </NavDrawer>,
            );
            expect(probe.nav!.isOpen).toBe(false);
            expect(result.queryByText('SidebarBody')).toBeNull();
            expect(findBackdrop(result.container)).toBeNull();

            act(() => probe.nav!.open());
            expect(probe.nav!.isOpen).toBe(true);
            expect(result.queryByText('SidebarBody')).not.toBeNull();
            expect(findBackdrop(result.container)).not.toBeNull();

            // Close kicks off the exit animation; chrome stays mounted
            // until the exit timer fires so the slide-out is visible.
            act(() => probe.nav!.close());
            expect(probe.nav!.isOpen).toBe(false);
            expect(result.queryByText('SidebarBody')).not.toBeNull();

            // Advance past the exit duration — chrome unmounts.
            act(() => { vi.advanceTimersByTime(300); });
            expect(result.queryByText('SidebarBody')).toBeNull();
            expect(findBackdrop(result.container)).toBeNull();

            result.unmount();
        } finally {
            vi.useRealTimers();
        }
    });
});
