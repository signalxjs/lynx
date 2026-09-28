/**
 * Zero wave 3, display (W3D, #1236): Divider, Stats and EmptyState held to
 * BOTH oracles (anatomy + class grammar), plus the lynx-only wiring each one
 * needs — the divider's drawn segments, the stats item's `first`/`figure`
 * stamps and re-carried colour.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Button, Divider, EmptyState, Stats, registerAxisDefaults } from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import { dividerSegmentClass } from '../src/components/divider/Divider';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

type Node = { type?: string; props: Record<string, unknown>; children: Node[]; _class?: string; _style?: Record<string, unknown> };

const conforms = (container: never, scope: keyof typeof anatomies): void => {
    expectAnatomy(container, anatomies[scope]);
    expectClassGrammar(container, anatomies[scope]);
};

function partsOf(root: Node, scope: string, part: string, out: Node[] = []): Node[] {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) out.push(root);
    for (const child of root.children) partsOf(child, scope, part, out);
    return out;
}

/** The divider's drawn segments: the root's children that are not parts. */
const segmentsOf = (root: Node): Node[] => elementsOf(root).filter((child) => classOf(child).includes('zx-m-segment'));

/** A node's element children (the renderer's comment/text anchors dropped). */
const elementsOf = (root: Node): Node[] => root.children.filter((child) => child.type === 'view' || child.type === 'text');

const classOf = (node: Node): string[] => String(node._class ?? node.props['class'] ?? '').split(/\s+/);

/** Let the after-mount joins (a Label, a Figure) land: they run a microtask after mount. */
const settle = (): Promise<void> => act(async () => {});

afterEach(() => clearAxisDefaults());

describe('Divider', () => {
    it('an unlabelled divider is the line itself: no segments, not an accessibility element', () => {
        const { container } = render(<Divider color="primary" size="lg" />);
        conforms(container as never, 'divider');
        const root = partsOf(container as never, 'divider', 'root')[0]!;
        expect(classOf(root)).toEqual(expect.arrayContaining(['zx-divider__root', 'zx-o-horizontal', 'zx-a-color-primary', 'zx-a-size-lg']));
        expect(classOf(root)).not.toContain('zx-m-labelled');
        expect(root.props['data-orientation']).toBe('horizontal');
        expect(root.props['accessibility-element']).toBe(false);
        expect(elementsOf(root)).toHaveLength(0);
    });

    it('vertical orientation reaches the root', () => {
        const { container } = render(<Divider orientation="vertical" />);
        conforms(container as never, 'divider');
        const root = partsOf(container as never, 'divider', 'root')[0]!;
        expect(classOf(root)).toContain('zx-o-vertical');
        expect(root.props['data-orientation']).toBe('vertical');
    });

    it('a Label draws a segment on each side and lifts the root out of being a line', async () => {
        const { container } = render(
            <Divider.Root color="secondary" size="xl">
                <Divider.Label>or</Divider.Label>
            </Divider.Root>,
        );
        await settle();
        conforms(container as never, 'divider');
        const root = partsOf(container as never, 'divider', 'root')[0]!;
        expect(classOf(root)).toContain('zx-m-labelled');
        expect(root.props['data-mod-labelled']).toBe('');
        expect(root._style).toMatchObject({ height: 'auto', backgroundColor: 'transparent' });
        const kids = elementsOf(root);
        expect(kids).toHaveLength(3);
        const [before, label, after] = kids;
        expect(label!.props['data-part']).toBe('label');
        expect(label!.type).toBe('text');
        for (const segment of [before!, after!]) {
            // The same line classes the root paints with — ink, thickness, colour.
            expect(classOf(segment)).toEqual(expect.arrayContaining([
                'zx-divider__root', 'zx-m-segment', 'zx-o-horizontal', 'zx-a-color-secondary', 'zx-a-size-xl',
            ]));
            // Decoration, not a part.
            expect(segment.props['data-part']).toBeUndefined();
            expect(segment.props['accessibility-element']).toBe(false);
            expect(segment._style).toMatchObject({ flexGrow: 1 });
        }
        // The label carries its axes and the orientation for the skin's vertical padding.
        expect(classOf(label!)).toEqual(expect.arrayContaining(['zx-divider__label', 'zx-o-horizontal', 'zx-a-color-secondary']));
        expect(container.findByText('or')).not.toBeNull();
    });

    it('placement drops the segment on the Label\'s side', async () => {
        const start = render(
            <Divider.Root>
                <Divider.Label placement="start">Billing</Divider.Label>
            </Divider.Root>,
        ).container as never as Node;
        await settle();
        conforms(start as never, 'divider');
        const startRoot = partsOf(start, 'divider', 'root')[0]!;
        expect(elementsOf(startRoot).map((c) => c.props['data-part'] ?? 'segment')).toEqual(['label', 'segment']);
        expect(segmentsOf(startRoot)).toHaveLength(1);
        const label = partsOf(start, 'divider', 'label')[0]!;
        expect(label.props['data-placement']).toBe('start');
        expect(classOf(label)).toContain('zx-p-start');

        const end = render(
            <Divider.Root orientation="vertical">
                <Divider.Label placement="end">End</Divider.Label>
            </Divider.Root>,
        ).container as never as Node;
        await settle();
        conforms(end as never, 'divider');
        const endRoot = partsOf(end, 'divider', 'root')[0]!;
        expect(elementsOf(endRoot).map((c) => c.props['data-part'] ?? 'segment')).toEqual(['segment', 'label']);
        expect(endRoot._style).toMatchObject({ width: 'auto', backgroundColor: 'transparent' });
        expect(classOf(segmentsOf(endRoot)[0]!)).toContain('zx-o-vertical');
        expect(classOf(partsOf(end, 'divider', 'label')[0]!)).toContain('zx-o-vertical');
    });

    it('drops back to a plain line when the Label unmounts', async () => {
        const show = signal({ on: true });
        const Probe = component(() => () => (
            <Divider.Root>{show.on ? <Divider.Label>or</Divider.Label> : null}</Divider.Root>
        ));
        const { container } = render(<Probe />);
        const root = () => partsOf(container as never, 'divider', 'root')[0]!;
        await settle();
        expect(segmentsOf(root())).toHaveLength(2);
        await act(() => { show.on = false; });
        expect(elementsOf(root())).toHaveLength(0);
        expect(classOf(root())).not.toContain('zx-m-labelled');
        expect(root()._style ?? {}).not.toHaveProperty('backgroundColor');
        conforms(container as never, 'divider');
    });

    it('the registered default colour reaches root and segments alike', async () => {
        registerAxisDefaults({ divider: { color: 'neutral' } });
        const { container } = render(<Divider.Root><Divider.Label>x</Divider.Label></Divider.Root>);
        await settle();
        expect(segmentsOf(partsOf(container as never, 'divider', 'root')[0]!)).toHaveLength(2);
        conforms(container as never, 'divider');
        const root = partsOf(container as never, 'divider', 'root')[0]!;
        expect(classOf(root)).toContain('zx-a-color-neutral');
        for (const segment of segmentsOf(root)) expect(classOf(segment)).toContain('zx-a-color-neutral');
    });

    it('the segment class is the root line plus the segment modifier', () => {
        expect(dividerSegmentClass('vertical', { color: 'error', size: 'sm' }).split(' ')).toEqual([
            'zx-divider__root', 'zx-m-segment', 'zx-o-vertical', 'zx-a-color-error', 'zx-a-size-sm',
        ]);
    });
});

describe('Stats', () => {
    const Row = component<{ orientation?: 'horizontal' | 'vertical'; itemColor?: string }>(({ props }) => () => (
        <Stats.Root orientation={props.orientation} color="neutral" size="sm">
            <Stats.Item>
                <Stats.Figure><text>$</text></Stats.Figure>
                <Stats.Title>Revenue</Stats.Title>
                <Stats.Value>$12,930</Stats.Value>
                <Stats.Desc>+8%</Stats.Desc>
            </Stats.Item>
            <Stats.Item color={props.itemColor}>
                <Stats.Title>Refunds</Stats.Title>
                <Stats.Value>31</Stats.Value>
            </Stats.Item>
        </Stats.Root>
    ));

    it('conforms; orientation reaches every item; only the first item is stamped first', () => {
        const { container } = render(<Row />);
        conforms(container as never, 'stats');
        const [a, b] = partsOf(container as never, 'stats', 'item');
        for (const item of [a!, b!]) {
            expect(item.props['data-orientation']).toBe('horizontal');
            expect(classOf(item)).toContain('zx-o-horizontal');
        }
        expect(classOf(a!)).toContain('zx-m-first');
        expect(a!.props['data-mod-first']).toBe('');
        expect(classOf(b!)).not.toContain('zx-m-first');
        const root = partsOf(container as never, 'stats', 'root')[0]!;
        expect(classOf(root)).toEqual(expect.arrayContaining(['zx-o-horizontal', 'zx-a-color-neutral', 'zx-a-size-sm']));
    });

    it('an item holding a Figure is stamped figure; the bands are text', async () => {
        const { container } = render(<Row />);
        await settle();
        const [a, b] = partsOf(container as never, 'stats', 'item');
        expect(classOf(a!)).toContain('zx-m-figure');
        expect(classOf(b!)).not.toContain('zx-m-figure');
        for (const part of ['title', 'value', 'desc']) {
            for (const node of partsOf(container as never, 'stats', part)) expect(node.type).toBe('text');
        }
        const figure = partsOf(container as never, 'stats', 'figure')[0]!;
        expect(figure.props['accessibility-element']).toBe(false);
        // The size axis reaches the value (the skin's ramp is keyed on it).
        for (const value of partsOf(container as never, 'stats', 'value')) expect(classOf(value)).toContain('zx-a-size-sm');
    });

    it("an item's own colour outranks the root's, for it and its bands only", () => {
        const { container } = render(<Row itemColor="warning" />);
        conforms(container as never, 'stats');
        const [a, b] = partsOf(container as never, 'stats', 'item');
        expect(a!.props['data-color']).toBe('neutral');
        expect(b!.props['data-color']).toBe('warning');
        expect(classOf(b!)).toContain('zx-a-color-warning');
        expect(classOf(b!)).not.toContain('zx-a-color-neutral');
        const values = partsOf(container as never, 'stats', 'value');
        expect(classOf(values[0]!)).toContain('zx-a-color-neutral');
        expect(classOf(values[1]!)).toContain('zx-a-color-warning');
    });

    it('vertical: the items mirror it; the first stamp follows mount order', async () => {
        const items = signal({ list: ['a', 'b', 'c'] });
        const Probe = component(() => () => (
            <Stats.Root orientation="vertical">
                {items.list.map((key) => (
                    <Stats.Item key={key}><Stats.Value>{key}</Stats.Value></Stats.Item>
                ))}
            </Stats.Root>
        ));
        const { container } = render(<Probe />);
        conforms(container as never, 'stats');
        const firsts = () => partsOf(container as never, 'stats', 'item')
            .filter((item) => classOf(item).includes('zx-m-first'))
            .map((item) => partsOf(item, 'stats', 'value')[0]!.children.map((c) => (c.props['text'] ?? '')).join(''));
        for (const item of partsOf(container as never, 'stats', 'item')) expect(classOf(item)).toContain('zx-o-vertical');
        expect(firsts()).toHaveLength(1);
        await act(() => { items.list = ['b', 'c']; });
        const stamped = partsOf(container as never, 'stats', 'item').filter((item) => classOf(item).includes('zx-m-first'));
        expect(stamped).toHaveLength(1);
        expect(stamped[0]).toBe(partsOf(container as never, 'stats', 'item')[0]);
        conforms(container as never, 'stats');
    });
});

describe('EmptyState', () => {
    it('conforms with every part; the tone and size reach each part', () => {
        const { container } = render(
            <EmptyState.Root color="error" size="lg">
                <EmptyState.Icon><text>!</text></EmptyState.Icon>
                <EmptyState.Title>Could not load</EmptyState.Title>
                <EmptyState.Description>The server did not answer.</EmptyState.Description>
                <EmptyState.Actions>
                    <Button.Root><text>Try again</text></Button.Root>
                </EmptyState.Actions>
            </EmptyState.Root>,
        );
        conforms(container as never, 'empty-state');
        conforms(container as never, 'button');
        for (const part of ['root', 'icon', 'title', 'description', 'actions']) {
            const node = partsOf(container as never, 'empty-state', part)[0]!;
            expect(node, part).toBeDefined();
            expect(classOf(node)).toEqual(expect.arrayContaining([`zx-empty-state__${part}`, 'zx-a-color-error', 'zx-a-size-lg']));
        }
        expect(partsOf(container as never, 'empty-state', 'title')[0]!.type).toBe('text');
        expect(partsOf(container as never, 'empty-state', 'description')[0]!.type).toBe('text');
        expect(partsOf(container as never, 'empty-state', 'icon')[0]!.props['accessibility-element']).toBe(false);
        expect(container.findByText('Could not load')).not.toBeNull();
    });

    it('renders only the parts given (presence is the consumer\'s)', () => {
        const { container } = render(
            <EmptyState.Root>
                <EmptyState.Title>Nothing here yet</EmptyState.Title>
            </EmptyState.Root>,
        );
        conforms(container as never, 'empty-state');
        expect(partsOf(container as never, 'empty-state', 'icon')).toHaveLength(0);
        expect(partsOf(container as never, 'empty-state', 'actions')).toHaveLength(0);
    });

    it('a forced state that none of these anatomies declares stamps nothing', () => {
        // None of the three declares a flag: ForceStates must leave them untouched.
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <EmptyState.Root><EmptyState.Title>t</EmptyState.Title></EmptyState.Root>
                <Stats.Root><Stats.Item><Stats.Value>1</Stats.Value></Stats.Item></Stats.Root>
                <Divider.Root><Divider.Label>or</Divider.Label></Divider.Root>
            </ForceStates>,
        );
        conforms(container as never, 'empty-state');
        conforms(container as never, 'stats');
        conforms(container as never, 'divider');
        const all: Node[] = [];
        const walk = (n: Node): void => { all.push(n); n.children.forEach(walk); };
        walk(container as never);
        for (const node of all) {
            expect(classOf(node)).not.toContain('zx-f-pressed');
            expect(node.props['data-pressed']).toBeUndefined();
        }
    });
});
