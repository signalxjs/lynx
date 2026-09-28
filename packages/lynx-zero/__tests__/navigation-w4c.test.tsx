/**
 * Wave 4, navigation (W4C #1258, epic #1140): Pagination and Steps. Every
 * state the tests drive is held to BOTH oracles (anatomy + class grammar).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Pagination, Steps, registerAxisDefaults } from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import { paginationRow } from '../src/components/pagination/Pagination';
import { stepsLocked, stepsPhase, stepsTarget } from '../src/components/steps/Steps';
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

/** Let the one-turn deferrals (`Promise.resolve().then`) and their renders run. */
const flush = async (): Promise<void> => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

const tap = async (node: TestNode): Promise<void> => {
    await act(() => fireEvent.tap(node as never));
};

/** The row as the reader sees it: page numbers, `…` for an ellipsis. */
const rowOf = (container: TestNode): string[] => {
    const root = byPart(container, 'pagination', 'root')!;
    return root.children
        .filter((c) => c.props['data-part'] === 'item' || c.props['data-part'] === 'ellipsis')
        .map((c) => c.textContent());
};

afterEach(() => clearAxisDefaults());

describe('paginationRow', () => {
    it('is constant-width: the sibling block slides near an edge', () => {
        expect(paginationRow(1, 20, 1, 1)).toEqual([1, 2, 3, 4, 5, 'end-ellipsis', 20]);
        expect(paginationRow(10, 20, 1, 1)).toEqual([1, 'start-ellipsis', 9, 10, 11, 'end-ellipsis', 20]);
        expect(paginationRow(20, 20, 1, 1)).toEqual([1, 'start-ellipsis', 16, 17, 18, 19, 20]);
        for (let page = 1; page <= 20; page++) expect(paginationRow(page, 20, 1, 1)).toHaveLength(7);
    });

    it('shows every page when the range is short, and honours sibling/boundary counts', () => {
        expect(paginationRow(2, 5, 1, 1)).toEqual([1, 2, 3, 4, 5]);
        expect(paginationRow(1, 1, 1, 1)).toEqual([1]);
        expect(paginationRow(10, 20, 2, 2)).toEqual([1, 2, 'start-ellipsis', 8, 9, 10, 11, 12, 'end-ellipsis', 19, 20]);
        expect(paginationRow(10, 20, 0, 1)).toEqual([1, 'start-ellipsis', 10, 'end-ellipsis', 20]);
    });
});

describe('Pagination', () => {
    it('renders the window with prev/next, the current page active', () => {
        const { container } = render(<Pagination.Root count={10} defaultPage={5} />);
        expect(rowOf(container)).toEqual(['1', '…', '4', '5', '6', '…', '10']);
        const items = allParts(container, 'pagination', 'item');
        const current = items.find((i) => i.textContent() === '5')!;
        expect(current.props['data-state']).toBe('active');
        expect(current._class).toContain('zx-s-active');
        expect(current.props['accessibility-trait']).toBe('button');
        expect(current.props['accessibility-label']).toBe('Page 5');
        expect(current.props['accessibility-status']).toBe('selected');
        const other = items.find((i) => i.textContent() === '4')!;
        expect(other.props['data-state']).toBe('inactive');
        expect(other.props['accessibility-status']).toBeUndefined();
        // Ellipses are punctuation, out of the reader's way.
        expect(byPart(container, 'pagination', 'ellipsis')!.props['accessibility-element']).toBe(false);
        // No edges unless asked.
        expect(byPart(container, 'pagination', 'first-trigger')).toBeNull();
        expect(byPart(container, 'pagination', 'last-trigger')).toBeNull();
        const prev = byPart(container, 'pagination', 'prev-trigger')!;
        expect(prev.textContent()).toBe('‹');
        expect(prev.props['accessibility-label']).toBe('Previous page');
        conforms(container, 'pagination');
    });

    it('a tap moves the page; the window slides and pageChange fires', async () => {
        const changes: number[] = [];
        const { container } = render(<Pagination.Root count={10} onPageChange={(p: number) => changes.push(p)} />);
        expect(rowOf(container)).toEqual(['1', '2', '3', '4', '5', '…', '10']);
        await tap(allParts(container, 'pagination', 'item').find((i) => i.textContent() === '5')!);
        expect(changes).toEqual([5]);
        expect(rowOf(container)).toEqual(['1', '…', '4', '5', '6', '…', '10']);
        await tap(byPart(container, 'pagination', 'next-trigger')!);
        expect(changes).toEqual([5, 6]);
        await tap(byPart(container, 'pagination', 'prev-trigger')!);
        expect(changes).toEqual([5, 6, 5]);
        // Tapping the current page is not a change.
        await tap(allParts(container, 'pagination', 'item').find((i) => i.textContent() === '5')!);
        expect(changes).toEqual([5, 6, 5]);
        conforms(container, 'pagination');
    });

    it('bounds are disabled: prev/first on page 1, next/last on the last page', async () => {
        const changes: number[] = [];
        const { container } = render(<Pagination.Root count={4} withEdges onPageChange={(p: number) => changes.push(p)} />);
        const first = byPart(container, 'pagination', 'first-trigger')!;
        const prev = byPart(container, 'pagination', 'prev-trigger')!;
        expect(first.props['data-disabled']).toBe('');
        expect(first._class).toContain('zx-f-disabled');
        expect(first.props['accessibility-status']).toBe('disabled');
        expect(prev.props['data-disabled']).toBe('');
        await tap(prev);
        expect(changes).toEqual([]);
        expect(byPart(container, 'pagination', 'next-trigger')!.props['data-disabled']).toBeUndefined();
        await tap(byPart(container, 'pagination', 'last-trigger')!);
        expect(changes).toEqual([4]);
        expect(byPart(container, 'pagination', 'last-trigger')!.props['data-disabled']).toBe('');
        expect(byPart(container, 'pagination', 'next-trigger')!.props['data-disabled']).toBe('');
        expect(byPart(container, 'pagination', 'first-trigger')!.props['data-disabled']).toBeUndefined();
        await tap(byPart(container, 'pagination', 'first-trigger')!);
        expect(changes).toEqual([4, 1]);
        conforms(container, 'pagination');
    });

    it('a disabled root disables every control', async () => {
        const changes: number[] = [];
        const { container } = render(
            <Pagination.Root count={6} defaultPage={3} disabled withEdges onPageChange={(p: number) => changes.push(p)} />,
        );
        const root = byPart(container, 'pagination', 'root')!;
        expect(root._class).toContain('zx-f-disabled');
        for (const part of ['item', 'first-trigger', 'prev-trigger', 'next-trigger', 'last-trigger']) {
            for (const node of allParts(container, 'pagination', part)) {
                expect(node.props['data-disabled']).toBe('');
            }
        }
        await tap(allParts(container, 'pagination', 'item')[0]!);
        await tap(byPart(container, 'pagination', 'next-trigger')!);
        expect(changes).toEqual([]);
        conforms(container, 'pagination');
    });

    it('is controllable, clamps the model, and localizes names', async () => {
        const page = signal({ value: 99 });
        const Host = component(() => () => (
            <Pagination.Root
                count={5}
                model={() => page.value}
                pageLabel={(n: number) => `Sida ${n}`}
                prevLabel="Föregående"
                nextLabel="Nästa"
            />
        ));
        const { container } = render(<Host />);
        // 99 is out of range: the last page is current.
        const active = allParts(container, 'pagination', 'item').find((i) => i.props['data-state'] === 'active')!;
        expect(active.textContent()).toBe('5');
        expect(active.props['accessibility-label']).toBe('Sida 5');
        expect(byPart(container, 'pagination', 'next-trigger')!.props['accessibility-label']).toBe('Nästa');
        await act(() => { page.value = 2; });
        expect(allParts(container, 'pagination', 'item').find((i) => i.props['data-state'] === 'active')!.textContent()).toBe('2');
        await tap(byPart(container, 'pagination', 'next-trigger')!);
        expect(page.value).toBe(3);
    });

    it('stamps the resolved axes on every part, and forced flags on the controls', () => {
        registerAxisDefaults({ pagination: { color: 'primary', size: 'md' } });
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Pagination.Root count={10} defaultPage={5} size="lg" withEdges />
            </ForceStates>,
        );
        for (const part of ['root', 'item', 'ellipsis', 'first-trigger', 'prev-trigger', 'next-trigger', 'last-trigger']) {
            const node = byPart(container, 'pagination', part)!;
            expect(node._class).toContain('zx-a-color-primary');
            expect(node._class).toContain('zx-a-size-lg');
        }
        const item = byPart(container, 'pagination', 'item')!;
        expect(item._class).toContain('zx-f-pressed');
        expect(item._class).toContain('zx-f-focus-visible');
        // Flags land only where the anatomy declares them.
        expect(byPart(container, 'pagination', 'root')!._class).not.toContain('zx-f-pressed');
        expect(byPart(container, 'pagination', 'ellipsis')!._class).not.toContain('zx-f-pressed');
        conforms(container, 'pagination');
    });

    it('a touch drives the pressed flag on the touched control only', async () => {
        const { container } = render(<Pagination.Root count={3} />);
        const [one, two] = allParts(container, 'pagination', 'item');
        await act(() => fireEvent.touchStart(two as never));
        expect(allParts(container, 'pagination', 'item')[1]!._class).toContain('zx-f-pressed');
        expect(one!._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(two as never));
        expect(allParts(container, 'pagination', 'item')[1]!._class).not.toContain('zx-f-pressed');
        // A disabled bound never presses.
        const prev = byPart(container, 'pagination', 'prev-trigger')!;
        await act(() => fireEvent.touchStart(prev as never));
        expect(byPart(container, 'pagination', 'prev-trigger')!._class).not.toContain('zx-f-pressed');
    });
});

describe('steps pure helpers', () => {
    const e = (value: string, disabled = false) => ({ value, disabled });

    it('phase: before the current is complete, after is inactive', () => {
        const values = ['a', 'b', 'c'];
        expect(values.map((v) => stepsPhase(values, 'b', v, true))).toEqual(['complete', 'active', 'inactive']);
        expect(values.map((v) => stepsPhase(values, '', v, true))).toEqual(['inactive', 'inactive', 'inactive']);
        // Mid-registration the current step comes later: everything so far is walked.
        expect(stepsPhase(['a'], 'c', 'a', false)).toBe('complete');
        // Settled, a value no step carries walks nothing.
        expect(stepsPhase(values, 'zzz', 'a', true)).toBe('inactive');
    });

    it('target skips disabled steps and stops at a bound', () => {
        const list = [e('a'), e('b', true), e('c')];
        expect(stepsTarget(list, 'a', 1)).toBe('c');
        expect(stepsTarget(list, 'c', -1)).toBe('a');
        expect(stepsTarget(list, 'a', -1)).toBeUndefined();
        expect(stepsTarget(list, 'c', 1)).toBeUndefined();
        expect(stepsTarget(list, '', 1)).toBe('a');
        expect(stepsTarget(list, '', -1)).toBeUndefined();
    });

    it('linear locks every step past the next reachable one', () => {
        const list = [e('a'), e('b'), e('c'), e('d')];
        expect(list.map((s) => stepsLocked(list, 'a', s.value))).toEqual([false, false, true, true]);
        expect(list.map((s) => stepsLocked(list, 'c', s.value))).toEqual([false, false, false, false]);
        // A disabled next step: the reach skips it.
        const gap = [e('a'), e('b', true), e('c'), e('d')];
        expect(gap.map((s) => stepsLocked(gap, 'a', s.value))).toEqual([false, false, false, true]);
    });
});

const Rail = component<{ step?: string; color?: string; size?: string; orientation?: 'horizontal' | 'vertical'; linear?: boolean; disabled?: boolean; wizard?: boolean; onStepChange?: (v: string) => void }>(
    ({ props }) => () => (
        <Steps.Root
            defaultStep={props.step ?? 'b'}
            color={props.color}
            size={props.size}
            orientation={props.orientation}
            linear={props.linear}
            disabled={props.disabled}
            onStepChange={props.onStepChange}
        >
            {(['a', 'b', 'c'] as const).map((v, i) => (
                <Steps.Item key={v} value={v} label={`Step ${v}`}>
                    <Steps.Indicator><text>{String(i + 1)}</text></Steps.Indicator>
                    <Steps.Title>{v.toUpperCase()}</Steps.Title>
                    <Steps.Description>desc</Steps.Description>
                    {i < 2 ? <Steps.Separator /> : null}
                </Steps.Item>
            ))}
            {props.wizard
                ? (['a', 'b', 'c'] as const).map((v) => <Steps.Content key={`c-${v}`} value={v}><text>{`panel ${v}`}</text></Steps.Content>)
                : null}
            {props.wizard ? <Steps.PrevTrigger><text>Back</text></Steps.PrevTrigger> : null}
            {props.wizard ? <Steps.NextTrigger><text>Next</text></Steps.NextTrigger> : null}
        </Steps.Root>
    ),
);

describe('Steps', () => {
    it('derives complete / active / inactive from mount order on every band', async () => {
        const { container } = render(<Rail />);
        await flush();
        const items = allParts(container, 'steps', 'item');
        expect(items.map((i) => i.props['data-state'])).toEqual(['complete', 'active', 'inactive']);
        expect(items.map((i) => i._class.includes('zx-o-horizontal'))).toEqual([true, true, true]);
        expect(allParts(container, 'steps', 'indicator').map((i) => i.props['data-state'])).toEqual(['complete', 'active', 'inactive']);
        // The separator: complete once its own item is, else inactive.
        expect(allParts(container, 'steps', 'separator').map((s) => s.props['data-state'])).toEqual(['complete', 'inactive']);
        expect(byPart(container, 'steps', 'separator')!.props['accessibility-element']).toBe(false);
        expect(items[1]!.props['accessibility-status']).toBe('selected');
        expect(items[1]!.props['accessibility-label']).toBe('Step b');
        expect(byPart(container, 'steps', 'title')!.type).toBe('text');
        // A bare rail is not a wizard.
        expect(byPart(container, 'steps', 'root')!._class).not.toContain('zx-m-wizard');
        conforms(container, 'steps');
    });

    it('a tap selects a step and stepChange fires', async () => {
        const changes: string[] = [];
        const { container } = render(<Rail onStepChange={(v) => changes.push(v)} />);
        await flush();
        await tap(allParts(container, 'steps', 'item')[2]!);
        expect(changes).toEqual(['c']);
        expect(allParts(container, 'steps', 'item').map((i) => i.props['data-state'])).toEqual(['complete', 'complete', 'active']);
        expect(allParts(container, 'steps', 'separator').map((s) => s.props['data-state'])).toEqual(['complete', 'complete']);
        conforms(container, 'steps');
    });

    it('vertical orientation reaches the root, items and separators', async () => {
        const { container } = render(<Rail orientation="vertical" />);
        await flush();
        expect(byPart(container, 'steps', 'root')!._class).toContain('zx-o-vertical');
        expect(byPart(container, 'steps', 'item')!._class).toContain('zx-o-vertical');
        expect(byPart(container, 'steps', 'separator')!._class).toContain('zx-o-vertical');
        conforms(container, 'steps');
    });

    it('linear locks the steps past the next reachable one', async () => {
        const changes: string[] = [];
        const { container } = render(<Rail step="a" linear onStepChange={(v) => changes.push(v)} />);
        await flush();
        const items = allParts(container, 'steps', 'item');
        expect(items.map((i) => i.props['data-disabled'])).toEqual([undefined, undefined, '']);
        expect(items[2]!.props['accessibility-status']).toBe('disabled');
        await tap(items[2]!);
        expect(changes).toEqual([]);
        await tap(items[1]!);
        expect(changes).toEqual(['b']);
        expect(allParts(container, 'steps', 'item')[2]!.props['data-disabled']).toBeUndefined();
        conforms(container, 'steps');
    });

    it('invalid flags the item, its indicator and separator, and names it', async () => {
        const { container } = render(
            <Steps.Root defaultStep="a" invalidLabel=", fel">
                <Steps.Item value="a" invalid label="Pay">
                    <Steps.Indicator><text>!</text></Steps.Indicator>
                    <Steps.Separator />
                </Steps.Item>
                <Steps.Item value="b" invalid>
                    <Steps.Indicator><text>2</text></Steps.Indicator>
                </Steps.Item>
            </Steps.Root>,
        );
        await flush();
        const [pay, two] = allParts(container, 'steps', 'item');
        expect(pay!._class).toContain('zx-f-invalid');
        expect(pay!.props['accessibility-label']).toBe('Pay, fel');
        expect(byPart(container, 'steps', 'indicator')!._class).toContain('zx-f-invalid');
        expect(byPart(container, 'steps', 'separator')!._class).toContain('zx-f-invalid');
        // No label to append to: the words ride in the tree, visually hidden.
        expect(two!.textContent()).toContain(', fel');
        conforms(container, 'steps');
    });

    it('an item re-carries colour; the root colour reaches the rest', async () => {
        const { container } = render(
            <Steps.Root defaultStep="a" color="secondary">
                <Steps.Item value="a" color="error">
                    <Steps.Indicator><text>1</text></Steps.Indicator>
                    <Steps.Separator />
                </Steps.Item>
                <Steps.Item value="b">
                    <Steps.Indicator><text>2</text></Steps.Indicator>
                </Steps.Item>
            </Steps.Root>,
        );
        await flush();
        const [a, b] = allParts(container, 'steps', 'item');
        expect(a!._class).toContain('zx-a-color-error');
        expect(b!._class).toContain('zx-a-color-secondary');
        const [ia, ib] = allParts(container, 'steps', 'indicator');
        expect(ia!._class).toContain('zx-a-color-error');
        expect(ib!._class).toContain('zx-a-color-secondary');
        expect(byPart(container, 'steps', 'separator')!._class).toContain('zx-a-color-error');
        expect(byPart(container, 'steps', 'root')!._class).toContain('zx-a-color-secondary');
        conforms(container, 'steps');
    });

    it('the wizard: only the active panel renders; prev/next walk and stop at the bounds', async () => {
        const changes: string[] = [];
        const { container } = render(<Rail step="a" wizard onStepChange={(v) => changes.push(v)} />);
        await flush();
        expect(byPart(container, 'steps', 'root')!._class).toContain('zx-m-wizard');
        expect(allParts(container, 'steps', 'content').map((c) => c.textContent())).toEqual(['panel a']);
        const prev = byPart(container, 'steps', 'prev-trigger')!;
        expect(prev.props['data-disabled']).toBe('');
        await tap(prev);
        expect(changes).toEqual([]);
        await tap(byPart(container, 'steps', 'next-trigger')!);
        await tap(byPart(container, 'steps', 'next-trigger')!);
        expect(changes).toEqual(['b', 'c']);
        expect(allParts(container, 'steps', 'content').map((c) => c.textContent())).toEqual(['panel c']);
        expect(byPart(container, 'steps', 'next-trigger')!.props['data-disabled']).toBe('');
        expect(byPart(container, 'steps', 'prev-trigger')!.props['data-disabled']).toBeUndefined();
        await tap(byPart(container, 'steps', 'prev-trigger')!);
        expect(changes).toEqual(['b', 'c', 'b']);
        conforms(container, 'steps');
    });

    it('the wizard mod leaves with the last wizard part', async () => {
        const on = signal({ value: true });
        const Host = component(() => () => (
            <Steps.Root defaultStep="a">
                <Steps.Item value="a"><Steps.Title>A</Steps.Title></Steps.Item>
                {on.value ? <Steps.NextTrigger><text>Next</text></Steps.NextTrigger> : null}
            </Steps.Root>
        ));
        const { container } = render(<Host />);
        await flush();
        expect(byPart(container, 'steps', 'root')!._class).toContain('zx-m-wizard');
        await act(() => { on.value = false; });
        await flush();
        expect(byPart(container, 'steps', 'root')!._class).not.toContain('zx-m-wizard');
    });

    it('a disabled root disables every item and trigger', async () => {
        const changes: string[] = [];
        const { container } = render(<Rail wizard disabled onStepChange={(v) => changes.push(v)} />);
        await flush();
        expect(byPart(container, 'steps', 'root')!._class).toContain('zx-f-disabled');
        for (const item of allParts(container, 'steps', 'item')) expect(item.props['data-disabled']).toBe('');
        expect(byPart(container, 'steps', 'next-trigger')!.props['data-disabled']).toBe('');
        await tap(allParts(container, 'steps', 'item')[2]!);
        await tap(byPart(container, 'steps', 'next-trigger')!);
        expect(changes).toEqual([]);
        conforms(container, 'steps');
    });

    it('forced flags land on the interactive parts only; sizes stamp every band', async () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Rail wizard size="xl" />
            </ForceStates>,
        );
        await flush();
        const item = byPart(container, 'steps', 'item')!;
        expect(item._class).toContain('zx-f-pressed');
        expect(item._class).toContain('zx-f-focus-visible');
        expect(byPart(container, 'steps', 'next-trigger')!._class).toContain('zx-f-pressed');
        expect(byPart(container, 'steps', 'indicator')!._class).not.toContain('zx-f-pressed');
        for (const part of ['root', 'item', 'indicator', 'separator', 'title', 'description', 'content', 'prev-trigger']) {
            expect(byPart(container, 'steps', part)!._class).toContain('zx-a-size-xl');
        }
        conforms(container, 'steps');
    });

    it('a touch drives the pressed flag; an inert item never presses', async () => {
        const { container } = render(<Rail step="a" linear />);
        await flush();
        const [a, , c] = allParts(container, 'steps', 'item');
        await act(() => fireEvent.touchStart(a as never));
        expect(allParts(container, 'steps', 'item')[0]!._class).toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(a as never));
        expect(allParts(container, 'steps', 'item')[0]!._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchStart(c as never));
        expect(allParts(container, 'steps', 'item')[2]!._class).not.toContain('zx-f-pressed');
    });
});
