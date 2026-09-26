/**
 * Tabs + Accordion on zero 0.6's anatomy (#1145): the tabs indicator part
 * (zero#324) with its measured geometry, and the accordion's orientation,
 * root-level disabled and expanded status.
 *
 * `useViewportRect` is the one seam faked here: the real one measures on the
 * main thread, which the test renderer does not run. Each call hands back a
 * rect the test sets by hand, in creation order (list first, then each tab).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { Accordion, Tabs } from '../src/index';
import { computeIndicatorBox, indicatorStyle } from '../src/components/tabs/indicator';
import { expectAnatomy, expectClassGrammar } from '../src/testing/index';

interface FakeRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

const fakes = vi.hoisted(() => ({
    rects: [] as { rect: { value: unknown }; measure: () => void; measured: number }[],
}));

vi.mock('@sigx/lynx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx')>();
    return {
        ...actual,
        useViewportRect: () => {
            const entry = {
                ref: actual.useMainThreadRef(null),
                rect: actual.signal<{ value: unknown }>({ value: null }),
                measured: 0,
                measure: () => {
                    entry.measured++;
                },
            };
            fakes.rects.push(entry as never);
            return entry;
        },
    };
});

type Node = { props: Record<string, unknown>; children: Node[]; _class?: string; _style: Record<string, unknown> };

const partsOf = (root: Node, scope: string, part: string, out: Node[] = []): Node[] => {
    if (root.props['data-scope'] === scope && root.props['data-part'] === part) out.push(root);
    for (const child of root.children) partsOf(child, scope, part, out);
    return out;
};

const conforms = (container: never, scope: keyof typeof anatomies): void => {
    expectAnatomy(container, anatomies[scope]);
    expectClassGrammar(container, anatomies[scope]);
};

/** Fire a synthetic layoutchange (fireEvent has no helper for it). */
const fireLayout = (node: Node, size: { width: number; height: number }): void => {
    const handlers = (node as unknown as { _handlers: Map<string, (e: unknown) => void> })._handlers;
    handlers.get('bindlayoutchange')?.({ detail: { left: 0, top: 0, ...size } });
};

const setRect = (index: number, rect: FakeRect): void => {
    fakes.rects[index]!.rect.value = rect;
};

afterEach(() => {
    fakes.rects.length = 0;
});

describe('computeIndicatorBox', () => {
    const list = { left: 10, top: 100, width: 300, height: 40 };

    it('is null until both rects are known', () => {
        expect(computeIndicatorBox(null, list, null)).toBeNull();
        expect(computeIndicatorBox(list, null, null)).toBeNull();
    });

    it('places the tab box in the list coordinates', () => {
        const tab = { left: 90, top: 104, width: 60, height: 32 };
        expect(computeIndicatorBox(list, tab, null)).toEqual({ left: 80, top: 4, width: 60, height: 32 });
    });

    it('undoes a scale about the centre with the layout size', () => {
        // A 60×32 tab held at scale 0.9: the rect shrank around its centre.
        const scaled = { left: 93, top: 105.6, width: 54, height: 28.8 };
        expect(computeIndicatorBox(list, scaled, { width: 60, height: 32 }))
            .toEqual({ left: 80, top: 4, width: 60, height: 32 });
    });

    it('refuses non-finite or empty geometry', () => {
        expect(computeIndicatorBox(list, { left: Number.NaN, top: 0, width: 10, height: 10 }, null)).toBeNull();
        expect(computeIndicatorBox(list, { left: 0, top: 0, width: 0, height: 0 }, null)).toBeNull();
    });

    it('renders display:none until measured, then an absolute box', () => {
        expect(indicatorStyle(null)).toEqual({ display: 'none' });
        expect(indicatorStyle({ left: 80, top: 4, width: 60, height: 32 })).toEqual({
            position: 'absolute', left: '80px', top: '4px', width: '60px', height: '32px',
        });
    });
});

describe('Tabs.Indicator', () => {
    const Probe = () => (
        <Tabs.Root defaultValue="a" color="primary" variant="border">
            <Tabs.List>
                <Tabs.Tab value="a"><text>A</text></Tabs.Tab>
                <Tabs.Tab value="b"><text>B</text></Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="a"><text>panel-a</text></Tabs.Panel>
            <Tabs.Panel value="b"><text>panel-b</text></Tabs.Panel>
        </Tabs.Root>
    );

    it('the list renders its own indicator, hidden until measured; conforms', () => {
        const { container } = render(<Probe />);
        const [indicator, ...rest] = partsOf(container as never, 'tabs', 'indicator');
        expect(rest).toHaveLength(0);
        expect(indicator!._style['display']).toBe('none');
        expect(indicator!.props['accessibility-element']).toBe(false);
        expect(indicator!.props['data-orientation']).toBe('horizontal');
        // Axes push down onto the indicator like every other part.
        expect(indicator!._class).toContain('zx-a-color-primary');
        expect(indicator!._class).toContain('zx-a-variant-border');
        conforms(container as never, 'tabs');
    });

    it('follows the active tab once measured, and on every selection', async () => {
        const { container } = render(<Probe />);
        await act(() => {});
        // Mounting an indicator measured the list and both tabs.
        expect(fakes.rects.map((r) => r.measured).every((n) => n > 0)).toBe(true);
        const [tabA, tabB] = partsOf(container as never, 'tabs', 'tab');
        await act(() => {
            setRect(0, { left: 16, top: 200, width: 300, height: 48 });
            setRect(1, { left: 20, top: 204, width: 70, height: 40 });
            setRect(2, { left: 90, top: 204, width: 90, height: 40 });
            fireLayout(tabA!, { width: 70, height: 40 });
            fireLayout(tabB!, { width: 90, height: 40 });
        });
        const indicator = () => partsOf(container as never, 'tabs', 'indicator')[0]!;
        expect(indicator()._style).toMatchObject({ position: 'absolute', left: '4px', top: '4px', width: '70px', height: '40px' });
        expect(indicator()._style['display']).toBeUndefined();

        const before = fakes.rects[2]!.measured;
        await act(() => fireEvent.tap(tabB as never));
        // A selection re-measures the row…
        expect(fakes.rects[2]!.measured).toBeGreaterThan(before);
        // …and the box moves to the new active tab.
        expect(indicator()._style).toMatchObject({ left: '74px', width: '90px' });
        conforms(container as never, 'tabs');
    });

    it('an app-placed Tabs.Indicator replaces the list\'s own', async () => {
        const { container } = render(
            <Tabs.Root defaultValue="a">
                <Tabs.List>
                    <Tabs.Tab value="a"><text>A</text></Tabs.Tab>
                    <Tabs.Indicator class="mine" />
                </Tabs.List>
            </Tabs.Root>,
        );
        // The placed part registers during the list's render; the list drops
        // its own on the next turn.
        await act(() => {});
        const indicators = partsOf(container as never, 'tabs', 'indicator');
        expect(indicators).toHaveLength(1);
        expect(indicators[0]!._class).toContain('mine');
        conforms(container as never, 'tabs');
    });
});

describe('Accordion on zero 0.6', () => {
    const Probe = (props: { orientation?: 'horizontal' | 'vertical'; disabled?: boolean }) => (
        <Accordion.Root orientation={props.orientation} disabled={props.disabled} defaultValue={['one']}>
            <Accordion.Item value="one">
                <Accordion.Trigger><text>One</text></Accordion.Trigger>
                <Accordion.Panel><text>content-one</text></Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="two">
                <Accordion.Trigger><text>Two</text></Accordion.Trigger>
                <Accordion.Panel><text>content-two</text></Accordion.Panel>
            </Accordion.Item>
        </Accordion.Root>
    );

    it('orientation rides the root and every trigger (vertical by default)', () => {
        const vertical = render(<Probe />).container as never as Node;
        expect(partsOf(vertical, 'accordion', 'root')[0]!._class).toContain('zx-o-vertical');
        for (const trigger of partsOf(vertical, 'accordion', 'trigger')) {
            expect(trigger.props['data-orientation']).toBe('vertical');
        }
        conforms(vertical as never, 'accordion');

        const horizontal = render(<Probe orientation="horizontal" />).container as never as Node;
        expect(partsOf(horizontal, 'accordion', 'root')[0]!.props['data-orientation']).toBe('horizontal');
        for (const trigger of partsOf(horizontal, 'accordion', 'trigger')) {
            expect(trigger._class).toContain('zx-o-horizontal');
        }
        conforms(horizontal as never, 'accordion');
    });

    it('the trigger announces expanded/collapsed', async () => {
        const { container } = render(<Probe />);
        const [one, two] = partsOf(container as never, 'accordion', 'trigger');
        expect(one!.props['accessibility-status']).toBe('expanded');
        expect(two!.props['accessibility-status']).toBe('collapsed');
        await act(() => fireEvent.tap(two as never));
        expect(partsOf(container as never, 'accordion', 'trigger')[1]!.props['accessibility-status']).toBe('expanded');
    });

    it('a disabled root disables every item: flags stamped, taps ignored', async () => {
        const { container } = render(<Probe disabled />);
        for (const item of partsOf(container as never, 'accordion', 'item')) {
            expect(item._class).toContain('zx-f-disabled');
        }
        const [, two] = partsOf(container as never, 'accordion', 'trigger');
        expect(two!.props['accessibility-status']).toBe('collapsed, disabled');
        await act(() => fireEvent.tap(two as never));
        expect(container.textContent()).not.toContain('content-two');
        conforms(container as never, 'accordion');
    });
});
