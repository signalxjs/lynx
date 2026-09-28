/**
 * Wave 5, complex (W5C #1279, epic #1140): Carousel and Table. Every state
 * the tests drive is held to BOTH oracles (anatomy + class grammar).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Carousel, Table, nextTableSort, registerAxisDefaults } from '../src/index';
import type { TableColumn, TableSort } from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import { carouselClamp, carouselPageAt } from '../src/components/carousel/Carousel';
import { tableCellBox, tableFixedWidth, tableStacks } from '../src/components/table/Table';
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
const byPart = (root: TestNode, scope: string, part: string): TestNode | null => allParts(root, scope, part)[0] ?? null;

const tap = async (node: TestNode): Promise<void> => {
    await act(() => fireEvent.tap(node as never));
};

const handler = (node: TestNode, name: string): ((e: unknown) => void) | undefined =>
    (node as unknown as { _handlers: Map<string, (e: unknown) => void> })._handlers.get(name);

afterEach(() => clearAxisDefaults());

// ── Carousel ──

describe('carousel helpers', () => {
    it('carouselPageAt rounds the offset to a page, clamped', () => {
        expect(carouselPageAt(0, 300, 3)).toBe(0);
        expect(carouselPageAt(160, 300, 3)).toBe(1);
        expect(carouselPageAt(140, 300, 3)).toBe(0);
        expect(carouselPageAt(9000, 300, 3)).toBe(2);
        expect(carouselPageAt(-40, 300, 3)).toBe(0);
        expect(carouselPageAt(300, 0, 3)).toBe(0);
        expect(carouselPageAt(300, 300, 0)).toBe(0);
    });

    it('carouselClamp makes an index whole and in range', () => {
        expect(carouselClamp(1.7, 3)).toBe(1);
        expect(carouselClamp(9, 3)).toBe(2);
        expect(carouselClamp(-2, 3)).toBe(0);
        expect(carouselClamp(Number.NaN, 3)).toBe(0);
        expect(carouselClamp(undefined, 3)).toBe(0);
        expect(carouselClamp(4, 0)).toBe(4);
    });
});

const Slides = (props: { count?: number; extra?: Record<string, unknown> } = {}) => {
    const n = props.count ?? 3;
    return (
        <Carousel.Root {...(props.extra ?? {})}>
            <Carousel.Viewport>
                {Array.from({ length: n }, (_, i) => (
                    <Carousel.Item key={i}><text>{`Slide ${i + 1}`}</text></Carousel.Item>
                ))}
            </Carousel.Viewport>
            <Carousel.PrevTrigger />
            <Carousel.NextTrigger />
            <Carousel.IndicatorGroup>
                {Array.from({ length: n }, (_, i) => <Carousel.Indicator key={i} index={i} />)}
            </Carousel.IndicatorGroup>
        </Carousel.Root>
    );
};

/** Lay the viewport out at `width` and give it a spy `invoke` (its `scrollTo`). */
const layOut = async (container: TestNode, width: number): Promise<ReturnType<typeof vi.fn>> => {
    const viewport = byPart(container, 'carousel', 'viewport')!;
    const invoke = vi.fn(() => Promise.resolve());
    (viewport as unknown as { invoke: unknown }).invoke = invoke;
    await act(() => handler(viewport, 'bindlayoutchange')?.({ detail: { left: 0, top: 0, width, height: 120 } }));
    return invoke;
};

const scrollTo = async (container: TestNode, scrollLeft: number): Promise<void> => {
    const viewport = byPart(container, 'carousel', 'viewport')!;
    await act(() => fireEvent.scroll(viewport as never, { detail: { scrollLeft } } as never));
};

describe('Carousel', () => {
    it('renders the anatomy on a paging horizontal scroll-view and conforms', () => {
        const { container } = render(<Slides />);
        const viewport = byPart(container, 'carousel', 'viewport')!;
        expect(viewport.type).toBe('scroll-view');
        expect(viewport.props['scroll-orientation']).toBe('horizontal');
        expect(viewport.props['paging-enabled']).toBe(true);
        const items = allParts(container, 'carousel', 'item');
        expect(items.map((i) => i.props['data-state'])).toEqual(['active', 'inactive', 'inactive']);
        expect(items[0]!._class).toContain('zx-s-active');
        const prev = byPart(container, 'carousel', 'prev-trigger')!;
        expect(prev.textContent()).toBe('‹');
        expect(prev.props['accessibility-trait']).toBe('button');
        expect(prev.props['accessibility-label']).toBe('Previous slide');
        expect(byPart(container, 'carousel', 'next-trigger')!.props['accessibility-label']).toBe('Next slide');
        const dots = allParts(container, 'carousel', 'indicator');
        expect(dots.map((d) => d.props['data-state'])).toEqual(['active', 'inactive', 'inactive']);
        expect(dots[1]!.props['accessibility-label']).toBe('Go to slide 2');
        expect(dots[0]!.props['accessibility-status']).toBe('selected');
        expect(byPart(container, 'carousel', 'indicator-group')!._style).toMatchObject({ display: 'flex', flexDirection: 'row' });
        conforms(container, 'carousel');
    });

    it('sizes every slide to the measured viewport width', async () => {
        const { container } = render(<Slides />);
        await layOut(container, 320);
        for (const item of allParts(container, 'carousel', 'item')) {
            expect(item._style).toMatchObject({ width: '320px', flexShrink: 0 });
        }
        conforms(container, 'carousel');
    });

    it('prev/next clamp at the bounds and are disabled there; a move scrolls the viewport', async () => {
        const changes: number[] = [];
        const { container } = render(<Slides extra={{ onIndexChange: (i: number) => changes.push(i) }} />);
        const invoke = await layOut(container, 300);
        const prev = byPart(container, 'carousel', 'prev-trigger')!;
        const next = byPart(container, 'carousel', 'next-trigger')!;
        expect(prev.props['data-disabled']).toBe('');
        expect(prev._class).toContain('zx-f-disabled');
        expect(prev.props['accessibility-status']).toBe('disabled');
        await tap(prev);
        expect(changes).toEqual([]);
        await tap(next);
        expect(changes).toEqual([1]);
        expect(invoke).toHaveBeenLastCalledWith('scrollTo', { index: 1, smooth: true });
        expect(allParts(container, 'carousel', 'item')[1]!.props['data-state']).toBe('active');
        await tap(next);
        expect(changes).toEqual([1, 2]);
        expect(byPart(container, 'carousel', 'next-trigger')!.props['data-disabled']).toBe('');
        await tap(byPart(container, 'carousel', 'next-trigger')!);
        expect(changes).toEqual([1, 2]);
        expect(byPart(container, 'carousel', 'prev-trigger')!.props['data-disabled']).toBeUndefined();
        conforms(container, 'carousel');
    });

    it('a dot jumps to its slide; the glide does not report the pages it passes', async () => {
        const changes: number[] = [];
        const { container } = render(<Slides count={4} extra={{ onIndexChange: (i: number) => changes.push(i) }} />);
        const invoke = await layOut(container, 300);
        await tap(allParts(container, 'carousel', 'indicator')[3]!);
        expect(changes).toEqual([3]);
        expect(invoke).toHaveBeenLastCalledWith('scrollTo', { index: 3, smooth: true });
        // The native glide passes pages 1 and 2 on its way to 3.
        await scrollTo(container, 310);
        await scrollTo(container, 620);
        await scrollTo(container, 900);
        expect(changes).toEqual([3]);
        expect(allParts(container, 'carousel', 'indicator')[3]!.props['data-state']).toBe('active');
    });

    it('the model follows real scroll without scrolling back', async () => {
        const changes: number[] = [];
        const { container } = render(<Slides extra={{ onIndexChange: (i: number) => changes.push(i) }} />);
        const invoke = await layOut(container, 300);
        await scrollTo(container, 120);
        expect(changes).toEqual([]);
        await scrollTo(container, 290);
        expect(changes).toEqual([1]);
        await scrollTo(container, 600);
        expect(changes).toEqual([1, 2]);
        expect(invoke).not.toHaveBeenCalled();
        expect(allParts(container, 'carousel', 'item').map((i) => i.props['data-state'])).toEqual(['inactive', 'inactive', 'active']);
        conforms(container, 'carousel');
    });

    it('an interrupted glide releases its heading on scrollend', async () => {
        const changes: number[] = [];
        const { container } = render(<Slides count={4} extra={{ onIndexChange: (i: number) => changes.push(i) }} />);
        await layOut(container, 300);
        await tap(allParts(container, 'carousel', 'indicator')[3]!);
        const viewport = byPart(container, 'carousel', 'viewport')!;
        // The user caught it on page 1.
        await act(() => handler(viewport, 'bindscrollend')?.({ detail: { scrollLeft: 300 } }));
        expect(changes).toEqual([3, 1]);
    });

    it('starts on defaultIndex through scroll-left, not a glide; controlled writes glide', async () => {
        const slide = signal({ value: 2 });
        const Host = component(() => () => (
            <Carousel.Root model={() => slide.value}>
                <Carousel.Viewport>
                    <Carousel.Item><text>a</text></Carousel.Item>
                    <Carousel.Item><text>b</text></Carousel.Item>
                    <Carousel.Item><text>c</text></Carousel.Item>
                </Carousel.Viewport>
            </Carousel.Root>
        ));
        const { container } = render(<Host />);
        const invoke = await layOut(container, 200);
        expect(byPart(container, 'carousel', 'viewport')!.props['scroll-left']).toBe(400);
        expect(invoke).not.toHaveBeenCalled();
        await act(() => { slide.value = 0; });
        expect(invoke).toHaveBeenLastCalledWith('scrollTo', { index: 0, smooth: true });
        expect(allParts(container, 'carousel', 'item')[0]!.props['data-state']).toBe('active');
        // An out-of-range model renders its clamped slide.
        await act(() => { slide.value = 99; });
        expect(allParts(container, 'carousel', 'item')[2]!.props['data-state']).toBe('active');
    });

    it('stamps the resolved axes on every part, forced flags where declared', () => {
        registerAxisDefaults({ carousel: { color: 'primary', size: 'md' } });
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Slides extra={{ size: 'lg' }} />
            </ForceStates>,
        );
        for (const part of ['root', 'viewport', 'item', 'prev-trigger', 'next-trigger', 'indicator-group', 'indicator']) {
            const node = byPart(container, 'carousel', part)!;
            expect(node._class).toContain('zx-a-color-primary');
            expect(node._class).toContain('zx-a-size-lg');
        }
        for (const part of ['prev-trigger', 'next-trigger', 'indicator']) {
            const node = byPart(container, 'carousel', part)!;
            expect(node._class).toContain('zx-f-pressed');
            expect(node._class).toContain('zx-f-focus-visible');
        }
        expect(byPart(container, 'carousel', 'item')!._class).not.toContain('zx-f-pressed');
        conforms(container, 'carousel');
    });

    it('a touch drives the pressed flag on the touched trigger only; not at a bound', async () => {
        const { container } = render(<Slides />);
        const next = byPart(container, 'carousel', 'next-trigger')!;
        await act(() => fireEvent.touchStart(next as never));
        expect(byPart(container, 'carousel', 'next-trigger')!._class).toContain('zx-f-pressed');
        expect(byPart(container, 'carousel', 'prev-trigger')!._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(next as never));
        expect(byPart(container, 'carousel', 'next-trigger')!._class).not.toContain('zx-f-pressed');
        // prev is at its bound: disabled, so no held state.
        const prev = byPart(container, 'carousel', 'prev-trigger')!;
        await act(() => fireEvent.touchStart(prev as never));
        expect(byPart(container, 'carousel', 'prev-trigger')!._class).not.toContain('zx-f-pressed');
    });

    it('takes custom trigger content and labels', () => {
        const { container } = render(
            <Carousel.Root>
                <Carousel.Viewport><Carousel.Item><text>a</text></Carousel.Item></Carousel.Viewport>
                <Carousel.PrevTrigger label="Tillbaka"><text>Back</text></Carousel.PrevTrigger>
                <Carousel.NextTrigger label="Framåt"><text>Fwd</text></Carousel.NextTrigger>
            </Carousel.Root>,
        );
        const prev = byPart(container, 'carousel', 'prev-trigger')!;
        expect(prev.textContent()).toBe('Back');
        expect(prev.props['accessibility-label']).toBe('Tillbaka');
        // One slide: both triggers are at a bound.
        expect(prev.props['data-disabled']).toBe('');
        expect(byPart(container, 'carousel', 'next-trigger')!.props['data-disabled']).toBe('');
    });
});

// ── Table ──

describe('table helpers', () => {
    it('nextTableSort cycles two and three ways', () => {
        expect(nextTableSort(null, 'a')).toEqual({ column: 'a', direction: 'ascending' });
        expect(nextTableSort({ column: 'a', direction: 'ascending' }, 'a')).toEqual({ column: 'a', direction: 'descending' });
        expect(nextTableSort({ column: 'a', direction: 'descending' }, 'a')).toEqual({ column: 'a', direction: 'ascending' });
        expect(nextTableSort({ column: 'a', direction: 'descending' }, 'a', 'three')).toBeNull();
        expect(nextTableSort({ column: 'b', direction: 'descending' }, 'a')).toEqual({ column: 'a', direction: 'ascending' });
    });

    it('tableCellBox: fixed px, a % share, or a flex share of the slack', () => {
        const cols: TableColumn[] = [{ width: 80 }, { width: '40px' }, { width: '25%' }, {}, {}];
        expect(tableCellBox(cols, 0)).toMatchObject({ width: '80px', flexGrow: 0, flexShrink: 0 });
        expect(tableCellBox(cols, 0, 2)).toMatchObject({ width: '120px' });
        expect(tableCellBox(cols, 2)).toMatchObject({ width: '25%' });
        expect(tableCellBox(cols, 3)).toMatchObject({ flexGrow: 1, flexBasis: 0 });
        expect(tableCellBox(cols, 3, 2)).toMatchObject({ flexGrow: 2 });
        expect(tableCellBox([], 0)).toMatchObject({ flexGrow: 1 });
        expect(() => tableCellBox([{ width: '12ch' }], 0)).toThrow(/not a lynx width/);
    });

    it('tableFixedWidth: the sum only when every column is fixed', () => {
        expect(tableFixedWidth([{ width: 80 }, { width: '120px' }])).toBe(200);
        expect(tableFixedWidth([{ width: 80 }, {}])).toBeNull();
        expect(tableFixedWidth([])).toBeNull();
    });

    it('tableStacks resolves true and a breakpoint against the width', () => {
        expect(tableStacks(true, 2000)).toBe(true);
        expect(tableStacks(undefined, 100)).toBe(false);
        expect(tableStacks('md', 402)).toBe(true);
        expect(tableStacks('md', 900)).toBe(false);
        expect(() => tableStacks('huge', 400)).toThrow(/not a breakpoint/);
    });
});

const PEOPLE = [
    { name: 'Ada', age: 36 },
    { name: 'Linus', age: 54 },
    { name: 'Grace', age: 85 },
];

const Basic = (extra: Record<string, unknown> = {}, selected = -1) => (
    <Table.Root {...extra}>
        <Table.Caption>People</Table.Caption>
        <Table.Head>
            <Table.Row>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Age</Table.HeaderCell>
            </Table.Row>
        </Table.Head>
        <Table.Body>
            {PEOPLE.map((p, i) => (
                <Table.Row key={p.name} selected={i === selected}>
                    <Table.Cell>{p.name}</Table.Cell>
                    <Table.Cell>{String(p.age)}</Table.Cell>
                </Table.Row>
            ))}
        </Table.Body>
        <Table.Foot>
            <Table.Row>
                <Table.Cell colSpan={2}>3 people</Table.Cell>
            </Table.Row>
        </Table.Foot>
    </Table.Root>
);

describe('Table', () => {
    it('renders every part as a view (rows as flex rows) and conforms', () => {
        const { container } = render(Basic());
        const root = byPart(container, 'table', 'root')!;
        expect(root.type).toBe('view');
        for (const part of ['table', 'caption', 'head', 'body', 'foot', 'row', 'header-cell', 'cell']) {
            expect(byPart(container, 'table', part), part).not.toBeNull();
        }
        const row = byPart(container, 'table', 'row')!;
        expect(row._style).toMatchObject({ display: 'flex', flexDirection: 'row' });
        // String content lands in a <text>.
        const cell = byPart(container, 'table', 'cell')!;
        expect(cell.children.filter((c) => c.type === 'text')).toHaveLength(1);
        expect(cell.textContent()).toBe('Ada');
        expect(cell._style).toMatchObject({ flexGrow: 1, flexBasis: 0 });
        // colSpan grows the foot's cell over both columns.
        const foot = allParts(container, 'table', 'cell').at(-1)!;
        expect(foot._style).toMatchObject({ flexGrow: 2 });
        expect(byPart(container, 'table', 'caption')!.textContent()).toBe('People');
        // No sortable header: no state, no trigger.
        expect(byPart(container, 'table', 'header-cell')!.props['data-state']).toBeUndefined();
        expect(byPart(container, 'table', 'sort-trigger')).toBeNull();
        conforms(container, 'table');
    });

    it('selected rows carry the flag; zebra stripes the even, unselected body rows', async () => {
        const { container } = render(Basic({ mods: { zebra: true } }, 2));
        const bodyRows = allParts(byPart(container, 'table', 'body')!, 'table', 'row');
        expect(bodyRows.map((r) => r.props['data-mod-stripe'])).toEqual([undefined, '', undefined]);
        expect(bodyRows[1]!._class).toContain('zx-m-stripe');
        expect(bodyRows[1]!._class).toContain('zx-m-zebra');
        expect(bodyRows[2]!._class).toContain('zx-f-selected');
        // Head and foot rows never stripe.
        for (const section of ['head', 'foot']) {
            const row = byPart(byPart(container, 'table', section)!, 'table', 'row')!;
            expect(row._class).not.toContain('zx-m-stripe');
        }
        conforms(container, 'table');

        // A selected even row gives the stripe up.
        const second = render(Basic({ mods: { zebra: true } }, 1));
        const rows = allParts(byPart(second.container, 'table', 'body')!, 'table', 'row');
        expect(rows[1]!._class).toContain('zx-f-selected');
        expect(rows[1]!._class).not.toContain('zx-m-stripe');
    });

    it('without zebra no row stripes', () => {
        const { container } = render(Basic());
        for (const row of allParts(container, 'table', 'row')) expect(row._class).not.toContain('zx-m-stripe');
    });

    it('builds the header row from the column spec and sizes cells by their place', () => {
        const columns: TableColumn[] = [
            { key: 'name', label: 'Name', width: '50%' },
            { key: 'age', label: 'Age', align: 'end' },
        ];
        const { container } = render(
            <Table.Root columns={columns}>
                <Table.Head />
                <Table.Body>
                    <Table.Row>
                        <Table.Cell>Ada</Table.Cell>
                        <Table.Cell>36</Table.Cell>
                    </Table.Row>
                </Table.Body>
            </Table.Root>,
        );
        const headers = allParts(container, 'table', 'header-cell');
        expect(headers.map((h) => h.textContent())).toEqual(['Name', 'Age']);
        const cells = allParts(container, 'table', 'cell');
        expect(cells[0]!._style).toMatchObject({ width: '50%' });
        expect(cells[1]!._style).toMatchObject({ flexGrow: 1, alignItems: 'flex-end' });
        expect(cells[1]!.children.find((c) => c.type === 'text')!._style).toMatchObject({ textAlign: 'right' });
        expect(byPart(container, 'table', 'root')!.type).toBe('view');
        conforms(container, 'table');
    });

    it('a spec of fixed columns makes the root a horizontal scroll box', () => {
        const { container } = render(
            <Table.Root columns={[{ label: 'A', width: 200 }, { label: 'B', width: 240 }]}>
                <Table.Head />
            </Table.Root>,
        );
        const root = byPart(container, 'table', 'root')!;
        expect(root.type).toBe('scroll-view');
        expect(root.props['scroll-orientation']).toBe('horizontal');
        expect(byPart(container, 'table', 'table')!._style).toMatchObject({ width: '440px' });
        expect(allParts(container, 'table', 'header-cell')[1]!._style).toMatchObject({ width: '240px' });
        conforms(container, 'table');
    });

    it('a sortable header cycles model:sort through its trigger', async () => {
        const changes: (TableSort | null)[] = [];
        const { container } = render(
            <Table.Root sortCycle="three" onSortChange={(s: TableSort | null) => changes.push(s)}>
                <Table.Head>
                    <Table.Row>
                        <Table.HeaderCell sortable column="name">Name</Table.HeaderCell>
                        <Table.HeaderCell sortable column="age">Age</Table.HeaderCell>
                        <Table.HeaderCell>Notes</Table.HeaderCell>
                    </Table.Row>
                </Table.Head>
            </Table.Root>,
        );
        const cell = () => allParts(container, 'table', 'header-cell')[0]!;
        const trigger = () => allParts(container, 'table', 'sort-trigger')[0]!;
        const mark = () => allParts(container, 'table', 'sort-indicator')[0]!;
        expect(cell().props['data-state']).toBe('none');
        expect(trigger().props['data-state']).toBe('none');
        expect(mark().props['data-state']).toBe('none');
        expect(mark().textContent()).toBe('▲');
        expect(mark().props['accessibility-element']).toBe(false);
        expect(trigger().props['accessibility-trait']).toBe('button');
        expect(trigger().props['accessibility-label']).toBe('Name');
        expect(allParts(container, 'table', 'sort-trigger')).toHaveLength(2);
        conforms(container, 'table');

        await tap(trigger());
        expect(changes).toEqual([{ column: 'name', direction: 'ascending' }]);
        expect(cell()._class).toContain('zx-s-ascending');
        expect(trigger().props['accessibility-label']).toBe('Name, sorted ascending');
        conforms(container, 'table');
        await tap(trigger());
        expect(mark().props['data-state']).toBe('descending');
        expect(mark()._class).toContain('zx-s-descending');
        conforms(container, 'table');
        await tap(trigger());
        expect(changes.at(-1)).toBeNull();
        expect(cell().props['data-state']).toBe('none');
        // Another column takes the sort.
        await tap(allParts(container, 'table', 'sort-trigger')[1]!);
        expect(changes.at(-1)).toEqual({ column: 'age', direction: 'ascending' });
        expect(cell().props['data-state']).toBe('none');
    });

    it('is controllable; a disabled trigger keeps its sort and ignores taps', async () => {
        const sort = signal({ value: { column: 'name', direction: 'descending' } as TableSort | null });
        const Host = component(() => () => (
            <Table.Root model:sort={() => sort.value}>
                <Table.Head>
                    <Table.Row>
                        <Table.HeaderCell sortable column="name" disabled>Name</Table.HeaderCell>
                        <Table.HeaderCell sortable column="age">Age</Table.HeaderCell>
                    </Table.Row>
                </Table.Head>
            </Table.Root>
        ));
        const { container } = render(<Host />);
        const [name, age] = allParts(container, 'table', 'sort-trigger');
        expect(name!.props['data-state']).toBe('descending');
        expect(name!.props['data-disabled']).toBe('');
        expect(name!.props['accessibility-status']).toBe('disabled');
        await tap(name!);
        expect(sort.value).toEqual({ column: 'name', direction: 'descending' });
        await tap(age!);
        expect(sort.value).toEqual({ column: 'age', direction: 'ascending' });
        conforms(container, 'table');
    });

    it('holding a sort trigger drives pressed and reveals the unsorted mark', async () => {
        const { container } = render(
            <Table.Root>
                <Table.Head>
                    <Table.Row><Table.HeaderCell sortable column="n">N</Table.HeaderCell></Table.Row>
                </Table.Head>
            </Table.Root>,
        );
        const trigger = byPart(container, 'table', 'sort-trigger')!;
        expect(byPart(container, 'table', 'sort-indicator')!._class).not.toContain('zx-m-held');
        await act(() => fireEvent.touchStart(trigger as never));
        expect(byPart(container, 'table', 'sort-trigger')!._class).toContain('zx-f-pressed');
        expect(byPart(container, 'table', 'sort-indicator')!._class).toContain('zx-m-held');
        await act(() => fireEvent.touchEnd(trigger as never));
        expect(byPart(container, 'table', 'sort-indicator')!._class).not.toContain('zx-m-held');
    });

    it('a sortable header needs a column name', () => {
        expect(() => render(
            <Table.Root columns={[{ label: 'A' }]}>
                <Table.Head><Table.Row><Table.HeaderCell sortable column={0} /></Table.Row></Table.Head>
            </Table.Root>,
        )).toThrow(/needs a column name/);
    });

    it('stack: rows become labelled blocks, the head is hidden, parts stamp stacked', () => {
        const columns: TableColumn[] = [{ key: 'name', label: 'Name', width: 120 }, { key: 'age', label: 'Age', width: 60 }];
        const { container } = render(
            <Table.Root columns={columns} stack>
                <Table.Head />
                <Table.Body>
                    <Table.Row>
                        <Table.Cell>Ada</Table.Cell>
                        <Table.Cell column="age">36</Table.Cell>
                    </Table.Row>
                </Table.Body>
            </Table.Root>,
        );
        const root = byPart(container, 'table', 'root')!;
        // A stacked table fits its container: no scroll box.
        expect(root.type).toBe('view');
        expect(root._class).toContain('zx-m-stacked');
        expect(byPart(container, 'table', 'head')!._style).toMatchObject({ position: 'absolute', opacity: '0' });
        const row = byPart(byPart(container, 'table', 'body')!, 'table', 'row')!;
        expect(row._style).toMatchObject({ flexDirection: 'column' });
        expect(row._class).toContain('zx-m-stacked');
        const labels = allParts(container, 'table', 'cell-label');
        expect(labels.map((l) => l.textContent())).toEqual(['Name', 'Age']);
        expect(labels[0]!.props['accessibility-element']).toBe(false);
        const cell = byPart(container, 'table', 'cell')!;
        expect(cell._style).toMatchObject({ flexDirection: 'row' });
        expect(cell.textContent()).toBe('NameAda');
        conforms(container, 'table');
    });

    it('a breakpoint stack renders data-l-stack', () => {
        const { container } = render(Basic({ stack: 'md' }));
        expect(byPart(container, 'table', 'root')!.props['data-l-stack']).toBe('md');
    });

    it('stamps the resolved axes on every part, forced flags where declared', () => {
        registerAxisDefaults({ table: { color: 'primary', size: 'md' } });
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Table.Root size="sm">
                    <Table.Caption>c</Table.Caption>
                    <Table.Head>
                        <Table.Row><Table.HeaderCell sortable column="n">N</Table.HeaderCell></Table.Row>
                    </Table.Head>
                    <Table.Body>
                        <Table.Row><Table.Cell>1</Table.Cell></Table.Row>
                    </Table.Body>
                </Table.Root>
            </ForceStates>,
        );
        for (const part of ['root', 'table', 'caption', 'head', 'body', 'row', 'header-cell', 'sort-trigger', 'sort-indicator', 'cell']) {
            const node = byPart(container, 'table', part)!;
            expect(node._class, part).toContain('zx-a-color-primary');
            expect(node._class, part).toContain('zx-a-size-sm');
        }
        expect(byPart(container, 'table', 'root')!._class).toContain('zx-f-focus-visible');
        const trigger = byPart(container, 'table', 'sort-trigger')!;
        expect(trigger._class).toContain('zx-f-pressed');
        expect(trigger._class).toContain('zx-f-focus-visible');
        // A forced hold reveals the unsorted mark too.
        expect(byPart(container, 'table', 'sort-indicator')!._class).toContain('zx-m-held');
        expect(byPart(container, 'table', 'row')!._class).not.toContain('zx-f-pressed');
        conforms(container, 'table');
    });
});
