/**
 * Zero wave 4 — navigation, W4A (#1259): Menu and NavList on zero's
 * anatomy. Conformance (anatomy oracle + class grammar) is asserted with the
 * popups open — the popup and sub-popup live in the overlay outlet, which
 * the adapter's `portaled` option bridges back to their logical parent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { signal } from '@sigx/lynx';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { Menu, NavList, OverlayHost, clearDismissLayers, computeAnchorPosition, dismissTopLayer } from '../src/index';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

afterEach(() => clearDismissLayers());

const allParts = (root: TestNode, scope: string, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === scope && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};
const byPart = (root: TestNode, scope: string, part: string): TestNode | null => allParts(root, scope, part)[0] ?? null;
const menuPart = (root: TestNode, part: string): TestNode | null => byPart(root, 'menu', part);
const MENU_PORTALED = { portaled: ['popup', 'sub-popup'] } as const;

/** The popup's light-dismiss surface: the sibling rendered before it. */
const outsideSurface = (popup: TestNode): TestNode => popup.parent!.children[0]!;

interface Log {
    selects: string[];
    opens: boolean[];
}

function renderMenu(options: { defaultOpen?: boolean; closeOnSelect?: boolean; color?: string; size?: string; subOpen?: boolean } = {}) {
    const log: Log = { selects: [], opens: [] };
    const result = render(
        <OverlayHost>
            <Menu.Root
                defaultOpen={options.defaultOpen}
                closeOnSelect={options.closeOnSelect}
                color={options.color}
                size={options.size}
                onSelect={(v: string) => log.selects.push(v)}
                onOpenChange={(v: boolean) => log.opens.push(v)}
            >
                <Menu.Trigger><text>Actions</text></Menu.Trigger>
                <Menu.Popup>
                    <Menu.Item value="rename"><text>Rename</text><Menu.Shortcut>⌘R</Menu.Shortcut></Menu.Item>
                    <Menu.Item value="archive" disabled><text>Archive</text></Menu.Item>
                    <Menu.Separator />
                    <Menu.Group>
                        <Menu.GroupLabel>Share</Menu.GroupLabel>
                        <Menu.Sub defaultOpen={options.subOpen}>
                            <Menu.SubTrigger><text>Send to</text></Menu.SubTrigger>
                            <Menu.SubPopup>
                                <Menu.Item value="email"><text>Email</text></Menu.Item>
                            </Menu.SubPopup>
                        </Menu.Sub>
                    </Menu.Group>
                </Menu.Popup>
            </Menu.Root>
        </OverlayHost>,
    );
    return { ...result, log };
}

describe('Menu — trigger and popup', () => {
    it('renders the closed trigger alone, stamped with the resolved axes', () => {
        const { container } = renderMenu({ color: 'primary', size: 'lg' });
        const trigger = menuPart(container, 'trigger')!;
        expect(trigger.props['data-state']).toBe('closed');
        expect(trigger._class).toContain('zx-menu__trigger');
        expect(trigger._class).toContain('zx-a-color-primary');
        expect(trigger._class).toContain('zx-a-size-lg');
        expect(trigger.props['accessibility-trait']).toBe('button');
        expect(trigger.props['accessibility-status']).toBe('collapsed');
        expect(menuPart(container, 'popup')).toBeNull();
        expectAnatomy(container as never, anatomies.menu);
        expectClassGrammar(container as never, anatomies.menu);
    });

    it('a tap opens the popup in the outlet; every rendered part holds the contract', async () => {
        const { container, log } = renderMenu({ color: 'secondary' });
        await act(() => fireEvent.tap(menuPart(container, 'trigger') as never));
        await act(() => {});
        expect(log.opens).toEqual([true]);
        const trigger = menuPart(container, 'trigger')!;
        expect(trigger.props['data-state']).toBe('open');
        expect(trigger._class).toContain('zx-s-open');
        expect(trigger.props['accessibility-status']).toBe('expanded');
        const popup = menuPart(container, 'popup')!;
        expect(popup.props['data-state']).toBe('open');
        expect(popup.props['data-placement']).toBe('bottom-start');
        expect(popup._class).toContain('zx-p-bottom-start');
        // Rows stretch across the popup: a flex column, not lynx's linear default.
        expect(popup.props.style).toMatchObject({ display: 'flex', flexDirection: 'column' });
        // The overlay root opts back into touches (#1180).
        expect(popup.parent!.props.style).toMatchObject({ pointerEvents: 'auto' });
        // Axes push down across the portal.
        expect(menuPart(container, 'item')!._class).toContain('zx-a-color-secondary');
        expect(menuPart(container, 'separator')).not.toBeNull();
        expect(menuPart(container, 'shortcut')!.textContent()).toBe('⌘R');
        expect(menuPart(container, 'group-label')!.parent!.props['data-part']).toBe('group');
        expectAnatomy(container as never, anatomies.menu, MENU_PORTALED);
        expectClassGrammar(container as never, anatomies.menu);
    });

    it('a disabled trigger neither opens nor presses', async () => {
        const { container } = render(
            <OverlayHost>
                <Menu.Root>
                    <Menu.Trigger disabled><text>Actions</text></Menu.Trigger>
                    <Menu.Popup><Menu.Item value="a"><text>A</text></Menu.Item></Menu.Popup>
                </Menu.Root>
            </OverlayHost>,
        );
        const trigger = menuPart(container, 'trigger')!;
        expect(trigger._class).toContain('zx-f-disabled');
        expect(trigger.props['accessibility-status']).toBe('collapsed, disabled');
        await act(() => fireEvent.touchStart(trigger as never));
        expect(menuPart(container, 'trigger')!._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.tap(trigger as never));
        await act(() => {});
        expect(menuPart(container, 'popup')).toBeNull();
    });

    it('a held trigger stamps pressed', async () => {
        const { container } = renderMenu();
        const trigger = menuPart(container, 'trigger')!;
        await act(() => fireEvent.touchStart(trigger as never));
        expect(menuPart(container, 'trigger')!._class).toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(trigger as never));
        expect(menuPart(container, 'trigger')!._class).not.toContain('zx-f-pressed');
    });

    it('tapping an item selects its value and closes the menu', async () => {
        const { container, log } = renderMenu({ defaultOpen: true });
        await act(() => {});
        await act(() => fireEvent.tap(menuPart(container, 'item') as never));
        await act(() => {});
        expect(log.selects).toEqual(['rename']);
        expect(log.opens).toEqual([false]);
        expect(menuPart(container, 'popup')).toBeNull();
        expect(menuPart(container, 'trigger')!.props['data-state']).toBe('closed');
    });

    it('closeOnSelect={false} keeps the menu open after a pick', async () => {
        const { container, log } = renderMenu({ defaultOpen: true, closeOnSelect: false });
        await act(() => {});
        await act(() => fireEvent.tap(menuPart(container, 'item') as never));
        await act(() => {});
        expect(log.selects).toEqual(['rename']);
        expect(menuPart(container, 'popup')).not.toBeNull();
    });

    it('a disabled item is inert and announced disabled', async () => {
        const { container, log } = renderMenu({ defaultOpen: true });
        await act(() => {});
        const archive = allParts(container, 'menu', 'item')[1]!;
        expect(archive._class).toContain('zx-f-disabled');
        expect(archive.props['accessibility-status']).toBe('disabled');
        await act(() => fireEvent.touchStart(archive as never));
        expect(allParts(container, 'menu', 'item')[1]!._class).not.toContain('zx-f-highlighted');
        await act(() => fireEvent.tap(archive as never));
        await act(() => {});
        expect(log.selects).toEqual([]);
        expect(menuPart(container, 'popup')).not.toBeNull();
    });

    it('the item under the finger is highlighted and pressed', async () => {
        const { container } = renderMenu({ defaultOpen: true });
        await act(() => {});
        const item = menuPart(container, 'item')!;
        await act(() => fireEvent.touchStart(item as never));
        const held = menuPart(container, 'item')!;
        expect(held._class).toContain('zx-f-highlighted');
        expect(held._class).toContain('zx-f-pressed');
        expectAnatomy(container as never, anatomies.menu, MENU_PORTALED);
        await act(() => fireEvent.touchEnd(item as never));
        expect(menuPart(container, 'item')!._class).not.toContain('zx-f-highlighted');
    });

    it('a tap on the outside surface closes the menu', async () => {
        const { container, log } = renderMenu({ defaultOpen: true });
        await act(() => {});
        const popup = menuPart(container, 'popup')!;
        await act(() => fireEvent.tap(outsideSurface(popup) as never));
        await act(() => {});
        expect(menuPart(container, 'popup')).toBeNull();
        expect(log.opens).toEqual([false]);
        expect(log.selects).toEqual([]);
    });

    it('ForceStates reaches the trigger and the portaled rows, per part', async () => {
        const { container } = render(
            <OverlayHost>
                <ForceStates flags={{ 'focus-visible': true, pressed: true }} parts={['trigger']}>
                    <Menu.Root defaultOpen>
                        <Menu.Trigger><text>Actions</text></Menu.Trigger>
                        <Menu.Popup>
                            <ForceStates flags={{ highlighted: true }}>
                                <Menu.Item value="a"><text>A</text></Menu.Item>
                            </ForceStates>
                            <Menu.Item value="b"><text>B</text></Menu.Item>
                        </Menu.Popup>
                    </Menu.Root>
                </ForceStates>
            </OverlayHost>,
        );
        await act(() => {});
        const trigger = menuPart(container, 'trigger')!;
        expect(trigger._class).toContain('zx-f-focus-visible');
        expect(trigger._class).toContain('zx-f-pressed');
        const [a, b] = allParts(container, 'menu', 'item');
        expect(a!._class).toContain('zx-f-highlighted');
        expect(b!._class).not.toContain('zx-f-highlighted');
        // The trigger-narrowed forcing never reaches the rows.
        expect(b!._class).not.toContain('zx-f-pressed');
        expectAnatomy(container as never, anatomies.menu, MENU_PORTALED);
        expectClassGrammar(container as never, anatomies.menu);
    });
});

describe('Menu — checkbox and radio rows', () => {
    it('a CheckboxItem toggles, stays open, and reports checkedChange + select', async () => {
        const log: { checked: boolean[]; selects: string[] } = { checked: [], selects: [] };
        const { container } = render(
            <OverlayHost>
                <Menu.Root defaultOpen onSelect={(v: string) => log.selects.push(v)}>
                    <Menu.Trigger><text>View</text></Menu.Trigger>
                    <Menu.Popup>
                        <Menu.CheckboxItem value="wrap" onCheckedChange={(v: boolean) => log.checked.push(v)}>
                            <text>Word wrap</text>
                        </Menu.CheckboxItem>
                    </Menu.Popup>
                </Menu.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const row = menuPart(container, 'checkbox-item')!;
        expect(row.props['data-state']).toBe('unchecked');
        expect(row.props['accessibility-status']).toBe('unchecked');
        const mark = menuPart(container, 'item-indicator')!;
        expect(mark.props['data-state']).toBe('unchecked');
        expect(mark.textContent()).toBe('');
        expectAnatomy(container as never, anatomies.menu, MENU_PORTALED);

        await act(() => fireEvent.tap(row as never));
        await act(() => {});
        expect(log.checked).toEqual([true]);
        expect(log.selects).toEqual(['wrap']);
        expect(menuPart(container, 'popup')).not.toBeNull();
        expect(menuPart(container, 'checkbox-item')!._class).toContain('zx-s-checked');
        expect(menuPart(container, 'checkbox-item')!.props['accessibility-status']).toBe('checked');
        expect(menuPart(container, 'item-indicator')!.textContent()).toBe('✓');
        expect(menuPart(container, 'item-indicator')!._class).toContain('zx-s-checked');
        expectAnatomy(container as never, anatomies.menu, MENU_PORTALED);
        expectClassGrammar(container as never, anatomies.menu);
    });

    it('a CheckboxItem follows its model and closeOnSelect closes the menu', async () => {
        const state = signal({ on: true });
        const { container } = render(
            <OverlayHost>
                <Menu.Root defaultOpen>
                    <Menu.Trigger><text>View</text></Menu.Trigger>
                    <Menu.Popup>
                        <Menu.CheckboxItem value="wrap" closeOnSelect model={() => state.on}>
                            <text>Word wrap</text>
                        </Menu.CheckboxItem>
                    </Menu.Popup>
                </Menu.Root>
            </OverlayHost>,
        );
        await act(() => {});
        expect(menuPart(container, 'checkbox-item')!.props['data-state']).toBe('checked');
        await act(() => fireEvent.tap(menuPart(container, 'checkbox-item') as never));
        await act(() => {});
        expect(state.on).toBe(false);
        expect(menuPart(container, 'popup')).toBeNull();
    });

    it('a RadioGroup holds one value; its rows mirror it and render the group part', async () => {
        const values: string[] = [];
        const { container } = render(
            <OverlayHost>
                <Menu.Root defaultOpen>
                    <Menu.Trigger><text>Sort</text></Menu.Trigger>
                    <Menu.Popup>
                        <Menu.RadioGroup defaultValue="name" onValueChange={(v: string) => values.push(v)}>
                            <Menu.GroupLabel>Sort by</Menu.GroupLabel>
                            <Menu.RadioItem value="name"><text>Name</text></Menu.RadioItem>
                            <Menu.RadioItem value="date"><text>Date</text></Menu.RadioItem>
                            <Menu.RadioItem value="size" disabled><text>Size</text></Menu.RadioItem>
                        </Menu.RadioGroup>
                    </Menu.Popup>
                </Menu.Root>
            </OverlayHost>,
        );
        await act(() => {});
        const rows = () => allParts(container, 'menu', 'radio-item');
        expect(rows().map((r) => r.props['data-state'])).toEqual(['checked', 'unchecked', 'unchecked']);
        expect(rows()[0]!.parent!.props['data-part']).toBe('group');
        await act(() => fireEvent.tap(rows()[1] as never));
        await act(() => {});
        expect(values).toEqual(['date']);
        expect(rows().map((r) => r.props['data-state'])).toEqual(['unchecked', 'checked', 'unchecked']);
        expect(allParts(container, 'menu', 'item-indicator').map((m) => m.textContent())).toEqual(['', '✓', '']);
        // Radio rows stay open by default; a disabled one is inert.
        await act(() => fireEvent.tap(rows()[2] as never));
        await act(() => {});
        expect(values).toEqual(['date']);
        expect(menuPart(container, 'popup')).not.toBeNull();
        expectAnatomy(container as never, anatomies.menu, MENU_PORTALED);
        expectClassGrammar(container as never, anatomies.menu);
    });
});

describe('Menu — submenus', () => {
    it('a sub-trigger tap opens the sub-popup beside it, in its own outlet entry', async () => {
        const { container } = renderMenu({ defaultOpen: true });
        await act(() => {});
        const subTrigger = menuPart(container, 'sub-trigger')!;
        expect(subTrigger.props['data-state']).toBe('closed');
        // The chevron the web draws with ::after.
        expect(subTrigger.textContent()).toContain('›');
        expect(menuPart(container, 'sub-popup')).toBeNull();
        await act(() => fireEvent.tap(subTrigger as never));
        await act(() => {});
        expect(menuPart(container, 'sub-trigger')!.props['data-state']).toBe('open');
        expect(menuPart(container, 'sub-trigger')!.props['accessibility-status']).toBe('expanded');
        const sub = menuPart(container, 'sub-popup')!;
        expect(sub.props['data-state']).toBe('open');
        expect(sub.props['data-placement']).toBe('right-start');
        expect(sub.parent!.props.style).toMatchObject({ pointerEvents: 'auto' });
        expectAnatomy(container as never, anatomies.menu, MENU_PORTALED);
        expectClassGrammar(container as never, anatomies.menu);
        // A second tap closes it again.
        await act(() => fireEvent.tap(menuPart(container, 'sub-trigger') as never));
        await act(() => {});
        expect(menuPart(container, 'sub-popup')).toBeNull();
        expect(menuPart(container, 'popup')).not.toBeNull();
    });

    it('a pick inside the submenu reaches the root and closes the whole chain', async () => {
        const { container, log } = renderMenu({ defaultOpen: true, subOpen: true });
        await act(() => {});
        await act(() => {});
        const sub = menuPart(container, 'sub-popup')!;
        const email = allParts(sub, 'menu', 'item')[0]!;
        await act(() => fireEvent.tap(email as never));
        await act(() => {});
        expect(log.selects).toEqual(['email']);
        expect(menuPart(container, 'popup')).toBeNull();
        expect(menuPart(container, 'sub-popup')).toBeNull();
    });

    it('the dismiss stack closes the innermost level first; the outside surface closes the chain', async () => {
        const { container } = renderMenu({ defaultOpen: true, subOpen: true });
        await act(() => {});
        await act(() => {});
        expect(menuPart(container, 'sub-popup')).not.toBeNull();
        await act(() => { dismissTopLayer(); });
        await act(() => {});
        expect(menuPart(container, 'sub-popup')).toBeNull();
        expect(menuPart(container, 'popup')).not.toBeNull();

        await act(() => fireEvent.tap(menuPart(container, 'sub-trigger') as never));
        await act(() => {});
        expect(menuPart(container, 'sub-popup')).not.toBeNull();
        await act(() => fireEvent.tap(outsideSurface(menuPart(container, 'popup')!) as never));
        await act(() => {});
        expect(menuPart(container, 'popup')).toBeNull();
        expect(menuPart(container, 'sub-popup')).toBeNull();
    });
});

describe('computeAnchorPosition — shift (the submenu on a phone)', () => {
    // A sub-trigger row inside a 208-wide popup at the left of a 402pt screen.
    const anchor = { top: 100, left: 20, right: 228, bottom: 136, width: 208, height: 36 };
    const floating = { width: 208, height: 120 };
    const viewport = { width: 402, height: 874 };

    it('without shift, a popup that fits neither side keeps the preferred side (off-screen)', () => {
        const p = computeAnchorPosition(anchor, floating, viewport, { placement: 'right-start', offset: 0 });
        expect(p.placement).toBe('right-start');
        expect(p.left).toBe(228);
    });

    it('with shift, it slides back into the viewport along the main axis', () => {
        const p = computeAnchorPosition(anchor, floating, viewport, { placement: 'right-start', offset: 0, shift: true });
        expect(p.placement).toBe('right-start');
        expect(p.left).toBe(402 - 208 - 8);
        expect(p.top).toBe(100);
    });

    it('with shift, it takes the roomier side before clamping (a nested submenu, #1296)', () => {
        // The parent submenu slid against the trailing edge ([186..394]); its
        // `Image` row is the nested submenu's anchor. Neither side fits a
        // 208 panel, but the leading side has far more room: the nested
        // submenu flips there and covers the least of its parent.
        const row = { top: 160, left: 194, right: 386, bottom: 196, width: 192, height: 36 };
        const p = computeAnchorPosition(row, floating, viewport, { placement: 'right-start', offset: 0, shift: true });
        expect(p.placement).toBe('left-start');
        expect(p.left).toBe(8);
        expect(p.top).toBe(160);
        // It overlaps the parent's row by 22px, not the whole panel.
        expect(p.left + floating.width - row.left).toBe(22);
    });

    it('with shift, a preferred side that is also the roomier one is kept', () => {
        // A sub-trigger at the right of the screen, preferring left.
        const right = { top: 100, left: 174, right: 382, bottom: 136, width: 208, height: 36 };
        const p = computeAnchorPosition(right, floating, viewport, { placement: 'left-start', offset: 0, shift: true });
        expect(p.placement).toBe('left-start');
        expect(p.left).toBe(8);
    });

    it('the roomier-side rule is shift-only: a tooltip that fits neither side keeps its preferred side', () => {
        const row = { top: 160, left: 194, right: 386, bottom: 196, width: 192, height: 36 };
        const p = computeAnchorPosition(row, floating, viewport, { placement: 'right-start', offset: 0 });
        expect(p.placement).toBe('right-start');
        expect(p.left).toBe(386);
    });

    it('shift leaves a popup that fits alone', () => {
        const narrow = { width: 120, height: 120 };
        const p = computeAnchorPosition(anchor, narrow, viewport, { placement: 'right-start', offset: 0, shift: true });
        expect(p.left).toBe(228);
    });
});

describe('NavList', () => {
    function renderNav(current: string, options: { color?: string; size?: string } = {}) {
        const pressed: string[] = [];
        const result = render(
            <NavList.Root color={options.color} size={options.size}>
                <NavList.Group>
                    <NavList.Heading>Workspace</NavList.Heading>
                    <NavList.List>
                        {['inbox', 'drafts'].map((page) => (
                            <NavList.Item key={page}>
                                <NavList.Link current={current === page} onPress={() => pressed.push(page)}>
                                    <NavList.Icon><text>•</text></NavList.Icon>
                                    <text>{page}</text>
                                    <NavList.Meta><text>3</text></NavList.Meta>
                                </NavList.Link>
                            </NavList.Item>
                        ))}
                    </NavList.List>
                </NavList.Group>
            </NavList.Root>,
        );
        return { ...result, pressed };
    }

    it('renders every part inside its declared parent, with the current link active', () => {
        const { container } = renderNav('drafts', { color: 'primary', size: 'sm' });
        const links = allParts(container, 'nav-list', 'link');
        expect(links.map((l) => l.props['data-state'])).toEqual(['inactive', 'active']);
        expect(links[1]!._class).toContain('zx-s-active');
        expect(links[1]!.props['accessibility-trait']).toBe('link');
        expect(links[1]!.props['accessibility-status']).toBe('selected');
        expect(links[0]!.props['accessibility-status']).toBeUndefined();
        // Every part stamps the root's axes — the lynx CSS narrows flat.
        for (const part of ['root', 'group', 'heading', 'list', 'item', 'link', 'icon', 'meta']) {
            const node = byPart(container, 'nav-list', part)!;
            expect(node._class, part).toContain('zx-a-color-primary');
            expect(node._class, part).toContain('zx-a-size-sm');
        }
        expect(byPart(container, 'nav-list', 'heading')!.props['accessibility-trait']).toBe('header');
        // The web's block boxes, spelled as flex columns.
        for (const part of ['group', 'list', 'item']) {
            expect(byPart(container, 'nav-list', part)!.props.style, part).toMatchObject({ display: 'flex', flexDirection: 'column' });
        }
        expectAnatomy(container as never, anatomies['nav-list']);
        expectClassGrammar(container as never, anatomies['nav-list']);
    });

    it('a link tap emits press; the app decides where to go', async () => {
        const { container, pressed } = renderNav('inbox');
        await act(() => fireEvent.tap(allParts(container, 'nav-list', 'link')[1] as never));
        expect(pressed).toEqual(['drafts']);
    });

    it('a link never stamps a flag its anatomy does not declare', async () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <NavList.Root>
                    <NavList.List>
                        <NavList.Item><NavList.Link current><text>Home</text></NavList.Link></NavList.Item>
                    </NavList.List>
                </NavList.Root>
            </ForceStates>,
        );
        const link = byPart(container, 'nav-list', 'link')!;
        await act(() => fireEvent.touchStart(link as never));
        expect(byPart(container, 'nav-list', 'link')!._class).not.toContain('zx-f-');
        expectAnatomy(container as never, anatomies['nav-list']);
    });
});
