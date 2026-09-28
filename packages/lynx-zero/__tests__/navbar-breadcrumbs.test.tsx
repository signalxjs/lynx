/**
 * Wave 4 (#1257, epic #1140): Navbar and Breadcrumbs on the zero anatomy.
 * Every rendered state is held to BOTH oracles (anatomy + class grammar),
 * forced states included.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Breadcrumbs, Navbar, breadcrumbsHidden } from '../src/index';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

const conforms = (container: unknown, scope: keyof typeof anatomies): void => {
    expectAnatomy(container as never, anatomies[scope]);
    expectClassGrammar(container as never, anatomies[scope]);
};

const allParts = (root: TestNode, scope: string, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === scope && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};
const byPart = (root: TestNode, scope: string, part: string): TestNode => {
    const found = allParts(root, scope, part)[0];
    if (!found) throw new Error(`no ${scope}.${part}`);
    return found;
};
const textOf = (node: TestNode): string => node.textContent();

describe('Navbar', () => {
    const bar = (extra: Record<string, unknown> = {}) => (
        <Navbar.Root {...extra}>
            <Navbar.Start><text>Acme</text></Navbar.Start>
            <Navbar.Center><text>Inbox</text></Navbar.Center>
            <Navbar.End><text>Me</text></Navbar.End>
        </Navbar.Root>
    );

    it('renders root + three sections as views, conforming', () => {
        const { container } = render(bar());
        for (const part of ['root', 'start', 'center', 'end']) {
            expect(byPart(container, 'navbar', part).type).toBe('view');
        }
        expect(byPart(container, 'navbar', 'root')._class).toContain('zx-navbar__root');
        // No landmark on lynx: the bar is not an accessibility element.
        expect(byPart(container, 'navbar', 'root').props['accessibility-element']).toBeUndefined();
        conforms(container, 'navbar');
    });

    it('pushes color and size down to every section', () => {
        const { container } = render(bar({ color: 'primary', size: 'lg' }));
        for (const part of ['root', 'start', 'center', 'end']) {
            const node = byPart(container, 'navbar', part);
            expect(node._class).toContain('zx-a-color-primary');
            expect(node._class).toContain('zx-a-size-lg');
        }
        conforms(container, 'navbar');
    });

    it('every section is optional', () => {
        const { container } = render(<Navbar.Root><Navbar.End><text>x</text></Navbar.End></Navbar.Root>);
        expect(allParts(container, 'navbar', 'start')).toHaveLength(0);
        expect(allParts(container, 'navbar', 'end')).toHaveLength(1);
        conforms(container, 'navbar');
    });

    it('appends consumer classes', () => {
        const { container } = render(<Navbar.Root class="mine"><Navbar.Start class="s"><text>a</text></Navbar.Start></Navbar.Root>);
        expect(byPart(container, 'navbar', 'root')._class).toContain('mine');
        expect(byPart(container, 'navbar', 'start')._class).toContain('s');
    });
});

describe('breadcrumbsHidden', () => {
    it('hides nothing without maxItems, within it, or expanded', () => {
        expect(breadcrumbsHidden(5, {})).toEqual([]);
        expect(breadcrumbsHidden(3, { maxItems: 3 })).toEqual([]);
        expect(breadcrumbsHidden(5, { maxItems: 3, expanded: true })).toEqual([]);
    });

    it('keeps one leading and one trailing item by default', () => {
        expect(breadcrumbsHidden(5, { maxItems: 3 })).toEqual([1, 2, 3]);
    });

    it('honours before / after counts', () => {
        expect(breadcrumbsHidden(6, { maxItems: 3, itemsBeforeCollapse: 2, itemsAfterCollapse: 2 })).toEqual([2, 3]);
        // The kept ends already cover the trail: nothing to hide.
        expect(breadcrumbsHidden(4, { maxItems: 2, itemsBeforeCollapse: 2, itemsAfterCollapse: 2 })).toEqual([]);
    });

    it('reads bad numbers the way zero does', () => {
        expect(breadcrumbsHidden(5, { maxItems: Number.NaN })).toEqual([]);
        expect(breadcrumbsHidden(5, { maxItems: -1 })).toEqual([]);
        expect(breadcrumbsHidden(5, { maxItems: 3.7 })).toEqual([1, 2, 3]);
        expect(breadcrumbsHidden(5, { maxItems: 3, itemsBeforeCollapse: Number.NaN })).toEqual([1, 2, 3]);
        expect(breadcrumbsHidden(5, { maxItems: 3, itemsAfterCollapse: 0 })).toEqual([1, 2, 3, 4]);
    });
});

describe('Breadcrumbs', () => {
    const LABELS = ['Home', 'Docs', 'Zero', 'Anatomy', 'Breadcrumbs'];
    const trail = (root: Record<string, unknown> = {}, onPress?: (label: string) => void) => (
        <Breadcrumbs.Root {...root}>
            <Breadcrumbs.List>
                <Breadcrumbs.Item>
                    <Breadcrumbs.Link onPress={() => onPress?.(LABELS[0]!)}><text>{LABELS[0]}</text></Breadcrumbs.Link>
                    <Breadcrumbs.Separator />
                </Breadcrumbs.Item>
                <Breadcrumbs.Ellipsis>
                    <Breadcrumbs.EllipsisTrigger />
                    <Breadcrumbs.Separator />
                </Breadcrumbs.Ellipsis>
                {LABELS.slice(1).map((label, i) => (
                    <Breadcrumbs.Item key={label}>
                        <Breadcrumbs.Link current={i === LABELS.length - 2} onPress={() => onPress?.(label)}>
                            <text>{label}</text>
                        </Breadcrumbs.Link>
                        {i === LABELS.length - 2 ? null : <Breadcrumbs.Separator />}
                    </Breadcrumbs.Item>
                ))}
            </Breadcrumbs.List>
        </Breadcrumbs.Root>
    );

    it('renders the whole trail, the last link active, conforming', () => {
        const { container } = render(trail());
        expect(allParts(container, 'breadcrumbs', 'item')).toHaveLength(5);
        const links = allParts(container, 'breadcrumbs', 'link');
        expect(links.map((l) => l.props['data-state'])).toEqual(['inactive', 'inactive', 'inactive', 'inactive', 'active']);
        expect(links[4]!._class).toContain('zx-s-active');
        expect(links[0]!._class).toContain('zx-s-inactive');
        // Not collapsed: the ellipsis renders nothing.
        expect(allParts(container, 'breadcrumbs', 'ellipsis')).toHaveLength(0);
        for (const item of allParts(container, 'breadcrumbs', 'item')) expect(item.props['data-state']).toBe('open');
        conforms(container, 'breadcrumbs');
    });

    it('links are link-trait tap targets; the current one is announced selected', async () => {
        const pressed: string[] = [];
        const { container } = render(trail({}, (l) => pressed.push(l)));
        const links = allParts(container, 'breadcrumbs', 'link');
        expect(links[0]!.props['accessibility-trait']).toBe('link');
        expect(links[0]!.props['accessibility-status']).toBeUndefined();
        expect(links[4]!.props['accessibility-status']).toBe('selected');
        await act(() => fireEvent.tap(links[1]! as never));
        expect(pressed).toEqual(['Docs']);
    });

    it('the separator is a real text part, "/" by default, out of the a11y tree', () => {
        const { container } = render(trail());
        const seps = allParts(container, 'breadcrumbs', 'separator');
        // One per item but the last (the ellipsis is closed).
        expect(seps).toHaveLength(4);
        expect(seps[0]!.type).toBe('text');
        expect(textOf(seps[0]!)).toBe('/');
        expect(seps[0]!.props['accessibility-element']).toBe(false);

        const custom = render(
            <Breadcrumbs.Root><Breadcrumbs.List><Breadcrumbs.Item>
                <Breadcrumbs.Link><text>A</text></Breadcrumbs.Link>
                <Breadcrumbs.Separator>›</Breadcrumbs.Separator>
            </Breadcrumbs.Item></Breadcrumbs.List></Breadcrumbs.Root>,
        );
        expect(textOf(byPart(custom.container, 'breadcrumbs', 'separator'))).toBe('›');
    });

    it('pushes color and size down to every part', () => {
        const { container } = render(trail({ color: 'secondary', size: 'sm', maxItems: 3 }));
        for (const part of ['root', 'list', 'item', 'link', 'separator', 'ellipsis', 'ellipsis-trigger']) {
            const node = byPart(container, 'breadcrumbs', part);
            expect(node._class).toContain('zx-a-color-secondary');
            expect(node._class).toContain('zx-a-size-sm');
        }
        conforms(container, 'breadcrumbs');
    });

    it('collapses past maxItems: the middle items vanish and the ellipsis opens', () => {
        const { container } = render(trail({ maxItems: 3 }));
        const items = allParts(container, 'breadcrumbs', 'item');
        expect(items.map((i) => textOf(byPart(i, 'breadcrumbs', 'link')))).toEqual(['Home', 'Breadcrumbs']);
        const ellipsis = byPart(container, 'breadcrumbs', 'ellipsis');
        expect(ellipsis.props['data-state']).toBe('open');
        expect(ellipsis._class).toContain('zx-s-open');
        const trigger = byPart(container, 'breadcrumbs', 'ellipsis-trigger');
        expect(trigger.props['accessibility-trait']).toBe('button');
        expect(trigger.props['accessibility-label']).toBe('Show 3 more breadcrumbs');
        expect(trigger.props['accessibility-status']).toBe('collapsed');
        expect(textOf(trigger)).toBe('…');
        conforms(container, 'breadcrumbs');
    });

    it('the trigger expands the trail and emits expandedChange', async () => {
        const changes: boolean[] = [];
        const { container } = render(trail({ maxItems: 3, onExpandedChange: (v: boolean) => changes.push(v) }));
        await act(() => fireEvent.tap(byPart(container, 'breadcrumbs', 'ellipsis-trigger') as never));
        expect(changes).toEqual([true]);
        expect(allParts(container, 'breadcrumbs', 'item')).toHaveLength(5);
        expect(allParts(container, 'breadcrumbs', 'ellipsis')).toHaveLength(0);
        conforms(container, 'breadcrumbs');
    });

    it('model:expanded is controllable', async () => {
        const state = signal({ expanded: true });
        const Host = component(() => () => (
            <Breadcrumbs.Root maxItems={2} model:expanded={() => state.expanded}>
                <Breadcrumbs.List>
                    <Breadcrumbs.Item><Breadcrumbs.Link><text>Home</text></Breadcrumbs.Link></Breadcrumbs.Item>
                    <Breadcrumbs.Ellipsis><Breadcrumbs.EllipsisTrigger /></Breadcrumbs.Ellipsis>
                    {LABELS.slice(1).map((label) => (
                        <Breadcrumbs.Item key={label}><Breadcrumbs.Link><text>{label}</text></Breadcrumbs.Link></Breadcrumbs.Item>
                    ))}
                </Breadcrumbs.List>
            </Breadcrumbs.Root>
        ));
        const { container } = render(<Host />);
        expect(allParts(container, 'breadcrumbs', 'item')).toHaveLength(5);
        await act(() => { state.expanded = false; });
        expect(allParts(container, 'breadcrumbs', 'item')).toHaveLength(2);
        await act(() => fireEvent.tap(byPart(container, 'breadcrumbs', 'ellipsis-trigger') as never));
        expect(state.expanded).toBe(true);
        expect(allParts(container, 'breadcrumbs', 'item')).toHaveLength(5);
    });

    it('defaultExpanded starts the trail expanded; custom trigger label', () => {
        const open = render(trail({ maxItems: 3, defaultExpanded: true }));
        expect(allParts(open.container, 'breadcrumbs', 'item')).toHaveLength(5);

        const { container } = render(
            <Breadcrumbs.Root maxItems={1} itemsAfterCollapse={1}>
                <Breadcrumbs.List>
                    <Breadcrumbs.Item><Breadcrumbs.Link><text>A</text></Breadcrumbs.Link></Breadcrumbs.Item>
                    <Breadcrumbs.Ellipsis>
                        <Breadcrumbs.EllipsisTrigger label={(n) => `${n} hidden`}><text>...</text></Breadcrumbs.EllipsisTrigger>
                    </Breadcrumbs.Ellipsis>
                    <Breadcrumbs.Item><Breadcrumbs.Link><text>B</text></Breadcrumbs.Link></Breadcrumbs.Item>
                    <Breadcrumbs.Item><Breadcrumbs.Link current><text>C</text></Breadcrumbs.Link></Breadcrumbs.Item>
                </Breadcrumbs.List>
            </Breadcrumbs.Root>,
        );
        const trigger = byPart(container, 'breadcrumbs', 'ellipsis-trigger');
        expect(trigger.props['accessibility-label']).toBe('1 hidden');
        expect(textOf(trigger)).toBe('...');
    });

    it('a trail growing past maxItems collapses; shrinking back reopens', async () => {
        const state = signal({ n: 2 });
        const Host = component(() => () => (
            <Breadcrumbs.Root maxItems={3}>
                <Breadcrumbs.List>
                    <Breadcrumbs.Item><Breadcrumbs.Link><text>Root</text></Breadcrumbs.Link></Breadcrumbs.Item>
                    <Breadcrumbs.Ellipsis><Breadcrumbs.EllipsisTrigger /></Breadcrumbs.Ellipsis>
                    {Array.from({ length: state.n }, (_, i) => (
                        <Breadcrumbs.Item key={i}><Breadcrumbs.Link><text>{`L${i}`}</text></Breadcrumbs.Link></Breadcrumbs.Item>
                    ))}
                </Breadcrumbs.List>
            </Breadcrumbs.Root>
        ));
        const { container } = render(<Host />);
        expect(allParts(container, 'breadcrumbs', 'item')).toHaveLength(3);
        expect(allParts(container, 'breadcrumbs', 'ellipsis')).toHaveLength(0);
        await act(() => { state.n = 4; });
        expect(allParts(container, 'breadcrumbs', 'item')).toHaveLength(2);
        expect(byPart(container, 'breadcrumbs', 'ellipsis-trigger').props['accessibility-label']).toBe('Show 3 more breadcrumbs');
        await act(() => { state.n = 1; });
        expect(allParts(container, 'breadcrumbs', 'item')).toHaveLength(2);
        expect(allParts(container, 'breadcrumbs', 'ellipsis')).toHaveLength(0);
        conforms(container, 'breadcrumbs');
    });

    it('the trigger stamps pressed while held', async () => {
        const { container } = render(trail({ maxItems: 3 }));
        const trigger = (): TestNode => byPart(container, 'breadcrumbs', 'ellipsis-trigger');
        await act(() => fireEvent.touchStart(trigger() as never, { touches: [touch(1, 1)] }));
        expect(trigger()._class).toContain('zx-f-pressed');
        expect(trigger().props['data-pressed']).toBe('');
        conforms(container, 'breadcrumbs');
        await act(() => fireEvent.touchEnd(trigger() as never));
        expect(trigger()._class).not.toContain('zx-f-pressed');
    });

    it('ForceStates reaches the trigger only (links declare no flags)', () => {
        for (const flag of ['pressed', 'focus-visible']) {
            const { container } = render(<ForceStates flags={{ [flag]: true }}>{trail({ maxItems: 3 })}</ForceStates>);
            expect(byPart(container, 'breadcrumbs', 'ellipsis-trigger')._class).toContain(`zx-f-${flag}`);
            for (const link of allParts(container, 'breadcrumbs', 'link')) expect(link._class).not.toContain(`zx-f-${flag}`);
            conforms(container, 'breadcrumbs');
        }
    });
});
