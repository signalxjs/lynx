/**
 * Wave 2 (#1204, epic #1140): Toggle and ToggleGroup on the zero anatomy.
 * Every state the tests drive is held to BOTH oracles (anatomy + class
 * grammar), forced states included.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { provideFieldContext } from '@sigx/zero/behaviors/core';
import { component } from '@sigx/lynx';
import type { Define } from '@sigx/lynx';
import { signal } from '@sigx/lynx';
import { Toggle, ToggleGroup } from '../src/index';
import { toggleGroupEnds, toggleGroupNext, toggleGroupSelection } from '../src/components/toggle-group/ToggleGroup';
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

const press = async (node: TestNode): Promise<void> => {
    await act(() => fireEvent.touchStart(node as never, { touches: [touch(1, 1)] }));
    await act(() => fireEvent.touchEnd(node as never));
    await act(() => fireEvent.tap(node as never));
};

describe('Toggle', () => {
    it('flips on|off on tap, emits pressedChange, announces selected', async () => {
        const changes: boolean[] = [];
        const { container } = render(
            <Toggle.Root label="Bold" onPressedChange={(v: boolean) => changes.push(v)}><text>B</text></Toggle.Root>,
        );
        let root = byPart(container, 'toggle', 'root');
        expect(root.props['data-state']).toBe('off');
        expect(root._class).toContain('zx-s-off');
        expect(root.props['accessibility-trait']).toBe('button');
        expect(root.props['accessibility-label']).toBe('Bold');
        expect(root.props['accessibility-status']).toBeUndefined();
        conforms(container, 'toggle');

        await press(root);
        root = byPart(container, 'toggle', 'root');
        expect(changes).toEqual([true]);
        expect(root.props['data-state']).toBe('on');
        expect(root._class).toContain('zx-s-on');
        expect(root.props['accessibility-status']).toBe('selected');
        conforms(container, 'toggle');

        await press(root);
        expect(changes).toEqual([true, false]);
        expect(byPart(container, 'toggle', 'root').props['data-state']).toBe('off');
    });

    it('stamps the resolved axes (skin defaults when unset) and the explicit ones', () => {
        const { container } = render(<Toggle.Root color="secondary" size="lg"><text>B</text></Toggle.Root>);
        const root = byPart(container, 'toggle', 'root');
        expect(root._class).toContain('zx-a-color-secondary');
        expect(root._class).toContain('zx-a-size-lg');
        conforms(container, 'toggle');
    });

    it('the pressed FLAG (finger down) is independent of the on STATE', async () => {
        const { container } = render(<Toggle.Root defaultPressed><text>B</text></Toggle.Root>);
        const root = byPart(container, 'toggle', 'root');
        await act(() => fireEvent.touchStart(root as never, { touches: [touch(1, 1)] }));
        const held = byPart(container, 'toggle', 'root');
        expect(held._class).toContain('zx-s-on');
        expect(held._class).toContain('zx-f-pressed');
        expect(held.props['data-pressed']).toBe('');
        conforms(container, 'toggle');
        await act(() => fireEvent.touchEnd(root as never));
        expect(byPart(container, 'toggle', 'root')._class).not.toContain('zx-f-pressed');
    });

    it('controlled: follows the model and writes through it', async () => {
        const state = signal({ bold: false });
        const { container } = render(<Toggle.Root model={() => state.bold}><text>B</text></Toggle.Root>);
        await press(byPart(container, 'toggle', 'root'));
        expect(state.bold).toBe(true);
        await act(() => { state.bold = false; });
        expect(byPart(container, 'toggle', 'root').props['data-state']).toBe('off');
    });

    it('disabled: no flip, no press, announced disabled', async () => {
        const changes: boolean[] = [];
        const { container } = render(
            <Toggle.Root disabled onPressedChange={(v: boolean) => changes.push(v)}><text>B</text></Toggle.Root>,
        );
        const root = byPart(container, 'toggle', 'root');
        await act(() => fireEvent.touchStart(root as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'toggle', 'root')._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(root as never));
        await act(() => fireEvent.tap(root as never));
        expect(changes).toEqual([]);
        expect(root._class).toContain('zx-f-disabled');
        expect(root.props['accessibility-status']).toBe('disabled');
        conforms(container, 'toggle');
    });

    it('a disabled Field disables the toggle', async () => {
        const FieldHost = component<Define.Slot<'default'>>(({ slots }) => {
            provideFieldContext({
                inert: false,
                ids: { control: 'c', label: 'l', description: 'd', error: 'e' },
                disabled: () => true,
                invalid: () => false,
                required: () => false,
                readonly: () => false,
                size: () => 'sm',
                describedBy: () => undefined,
            });
            return () => slots.default?.();
        });
        const changes: boolean[] = [];
        const { container } = render(
            <FieldHost><Toggle.Root onPressedChange={(v: boolean) => changes.push(v)}><text>B</text></Toggle.Root></FieldHost>,
        );
        const root = byPart(container, 'toggle', 'root');
        await press(root);
        expect(changes).toEqual([]);
        expect(root._class).toContain('zx-f-disabled');
        expect(root._class).toContain('zx-a-size-sm');
    });

    it('ForceStates: pressed + focus-visible land on the root and conform', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Toggle.Root defaultPressed color="accent"><text>B</text></Toggle.Root>
            </ForceStates>,
        );
        const root = byPart(container, 'toggle', 'root');
        expect(root._class).toContain('zx-f-pressed');
        expect(root._class).toContain('zx-f-focus-visible');
        expect(root._class).toContain('zx-s-on');
        conforms(container, 'toggle');
    });
});

describe('ToggleGroup — the model rules', () => {
    it('toggleGroupSelection reads either shape', () => {
        expect(toggleGroupSelection('')).toEqual([]);
        expect(toggleGroupSelection('a')).toEqual(['a']);
        expect(toggleGroupSelection(['a', 'b', 'a'])).toEqual(['a', 'b']);
        expect(toggleGroupSelection(undefined)).toEqual([]);
    });

    it('toggleGroupNext: single replaces / deselects, multiple flips membership', () => {
        const single = { multiple: false, deselectable: true };
        expect(toggleGroupNext([], 'a', single)).toBe('a');
        expect(toggleGroupNext(['a'], 'b', single)).toBe('b');
        expect(toggleGroupNext(['a'], 'a', single)).toBe('');
        expect(toggleGroupNext(['a'], 'a', { ...single, deselectable: false })).toBe('a');
        const multi = { multiple: true, deselectable: true };
        expect(toggleGroupNext(['a'], 'b', multi)).toEqual(['a', 'b']);
        expect(toggleGroupNext(['a', 'b'], 'a', multi)).toEqual(['b']);
    });
});

describe('ToggleGroup', () => {
    const items = (container: TestNode): TestNode[] => allParts(container, 'toggle-group', 'item');

    it('single mode: one item on at a time, emits the string model', async () => {
        const changes: unknown[] = [];
        const { container } = render(
            <ToggleGroup.Root defaultValue="left" onValueChange={(v: string) => changes.push(v)}>
                <ToggleGroup.Item value="left"><text>L</text></ToggleGroup.Item>
                <ToggleGroup.Item value="center"><text>C</text></ToggleGroup.Item>
                <ToggleGroup.Item value="right"><text>R</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        expect(items(container).map((n) => n.props['data-state'])).toEqual(['on', 'off', 'off']);
        const on = items(container)[0]!;
        expect(on._class).toContain('zx-f-selected');
        expect(on.props['data-selected']).toBe('');
        expect(on.props['accessibility-status']).toBe('selected');
        expect(on.props['accessibility-trait']).toBe('button');
        conforms(container, 'toggle-group');

        await press(items(container)[2]!);
        expect(changes).toEqual(['right']);
        expect(items(container).map((n) => n.props['data-state'])).toEqual(['off', 'off', 'on']);
        // Tapping the on item deselects (the default).
        await press(items(container)[2]!);
        expect(changes).toEqual(['right', '']);
        expect(items(container).map((n) => n.props['data-state'])).toEqual(['off', 'off', 'off']);
        conforms(container, 'toggle-group');
    });

    it('deselectable={false} keeps the on item on', async () => {
        const changes: unknown[] = [];
        const { container } = render(
            <ToggleGroup.Root defaultValue="a" deselectable={false} onValueChange={(v: string) => changes.push(v)}>
                <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
                <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        await press(items(container)[0]!);
        expect(items(container)[0]!.props['data-state']).toBe('on');
        expect(changes).toEqual([]);
    });

    it('multiple: each item flips in and out of the array model', async () => {
        const state = signal({ marks: ['bold'] as string[] });
        const { container } = render(
            <ToggleGroup.Root multiple model={() => state.marks}>
                <ToggleGroup.Item value="bold"><text>B</text></ToggleGroup.Item>
                <ToggleGroup.Item value="italic"><text>I</text></ToggleGroup.Item>
                <ToggleGroup.Item value="underline"><text>U</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        await press(items(container)[1]!);
        expect([...state.marks]).toEqual(['bold', 'italic']);
        await press(items(container)[0]!);
        expect([...state.marks]).toEqual(['italic']);
        expect(items(container).map((n) => n.props['data-state'])).toEqual(['off', 'on', 'off']);
        conforms(container, 'toggle-group');
    });

    it('orientation rides the root and every item; axes reach the items', () => {
        const { container } = render(
            <ToggleGroup.Root orientation="vertical" color="success" size="xs">
                <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
                <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        const root = byPart(container, 'toggle-group', 'root');
        expect(root._class).toContain('zx-o-vertical');
        for (const item of items(container)) {
            expect(item._class).toContain('zx-o-vertical');
            expect(item._class).toContain('zx-a-color-success');
            expect(item._class).toContain('zx-a-size-xs');
        }
        conforms(container, 'toggle-group');
    });

    it('each item presses on its own', async () => {
        const { container } = render(
            <ToggleGroup.Root>
                <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
                <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        await act(() => fireEvent.touchStart(items(container)[1]! as never, { touches: [touch(1, 1)] }));
        expect(items(container).map((n) => n._class.includes('zx-f-pressed'))).toEqual([false, true]);
        conforms(container, 'toggle-group');
        await act(() => fireEvent.touchEnd(items(container)[1]! as never));
    });

    it('a disabled root disables every item; a disabled item refuses alone', async () => {
        const changes: unknown[] = [];
        const { container } = render(
            <ToggleGroup.Root disabled onValueChange={(v: string) => changes.push(v)}>
                <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
                <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        expect(byPart(container, 'toggle-group', 'root')._class).toContain('zx-f-disabled');
        for (const item of items(container)) expect(item._class).toContain('zx-f-disabled');
        await press(items(container)[0]!);
        expect(changes).toEqual([]);
        conforms(container, 'toggle-group');

        const second = render(
            <ToggleGroup.Root onValueChange={(v: string) => changes.push(v)}>
                <ToggleGroup.Item value="a" disabled><text>A</text></ToggleGroup.Item>
                <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        const [a, b] = items(second.container);
        await press(a!);
        expect(changes).toEqual([]);
        expect(a!.props['accessibility-status']).toBe('disabled');
        await press(b!);
        expect(changes).toEqual(['b']);
    });

    it('invalid + required flag the root; forced states conform', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <ToggleGroup.Root invalid required defaultValue="a">
                    <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
                    <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
                </ToggleGroup.Root>
            </ForceStates>,
        );
        const root = byPart(container, 'toggle-group', 'root');
        expect(root._class).toContain('zx-f-invalid');
        expect(root._class).toContain('zx-f-required');
        // pressed / focus-visible are item flags only.
        expect(root._class).not.toContain('zx-f-pressed');
        for (const item of items(container)) {
            expect(item._class).toContain('zx-f-pressed');
            expect(item._class).toContain('zx-f-focus-visible');
        }
        conforms(container, 'toggle-group');
    });

    it('toggleGroupEnds: the first and last ids of the order, both for an only one', () => {
        expect(toggleGroupEnds([4, 5, 6], 4)).toEqual({ first: true, last: false });
        expect(toggleGroupEnds([4, 5, 6], 5)).toEqual({ first: false, last: false });
        expect(toggleGroupEnds([4, 5, 6], 6)).toEqual({ first: false, last: true });
        expect(toggleGroupEnds([7], 7)).toEqual({ first: true, last: true });
        expect(toggleGroupEnds([], 1)).toEqual({ first: false, last: false });
        expect(toggleGroupEnds([4, 5], 9)).toEqual({ first: false, last: false });
    });

    it('stamps the join\'s end items first / last, in both orientations (#1218)', () => {
        for (const orientation of ['horizontal', 'vertical'] as const) {
            const { container } = render(
                <ToggleGroup.Root orientation={orientation}>
                    <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
                    <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
                    <ToggleGroup.Item value="c"><text>C</text></ToggleGroup.Item>
                </ToggleGroup.Root>,
            );
            const [a, b, c] = items(container);
            expect(a!._class, orientation).toContain('zx-m-first');
            expect(a!.props['data-mod-first']).toBe('');
            expect(a!._class).not.toContain('zx-m-last');
            expect(b!._class).not.toContain('zx-m-first');
            expect(b!._class).not.toContain('zx-m-last');
            expect(b!.props['data-mod-first']).toBeUndefined();
            expect(c!._class).toContain('zx-m-last');
            expect(c!.props['data-mod-last']).toBe('');
            expect(c!._class).not.toContain('zx-m-first');
            for (const item of [a, b, c]) expect(item!._class).toContain(`zx-o-${orientation}`);
            conforms(container, 'toggle-group');
        }
    });

    it('an only item is both ends; the ends move when an end item leaves', async () => {
        const solo = render(
            <ToggleGroup.Root>
                <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        const only = items(solo.container)[0]!;
        expect(only._class).toContain('zx-m-first');
        expect(only._class).toContain('zx-m-last');
        conforms(solo.container, 'toggle-group');

        const state = signal({ showFirst: true, showLast: true });
        const Host = component(() => () => (
            <ToggleGroup.Root>
                {state.showFirst ? <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item> : null}
                <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
                <ToggleGroup.Item value="c"><text>C</text></ToggleGroup.Item>
                {state.showLast ? <ToggleGroup.Item value="d"><text>D</text></ToggleGroup.Item> : null}
            </ToggleGroup.Root>
        ));
        const { container } = render(<Host />);
        const mods = () => items(container).map((n) => [n._class!.includes('zx-m-first'), n._class!.includes('zx-m-last')]);
        expect(mods()).toEqual([[true, false], [false, false], [false, false], [false, true]]);
        await act(() => { state.showFirst = false; });
        await act(() => { state.showLast = false; });
        expect(items(container).map((n) => n.props['data-mod-first'] !== undefined)).toEqual([true, false]);
        expect(mods()).toEqual([[true, false], [false, true]]);
        conforms(container, 'toggle-group');
    });

    it('forced states keep the end stamps and conform', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <ToggleGroup.Root defaultValue="a">
                    <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
                    <ToggleGroup.Item value="b"><text>B</text></ToggleGroup.Item>
                </ToggleGroup.Root>
            </ForceStates>,
        );
        const [a, b] = items(container);
        expect(a!._class).toContain('zx-m-first');
        expect(a!._class).toContain('zx-f-pressed');
        expect(b!._class).toContain('zx-m-last');
        expect(b!._class).toContain('zx-f-focus-visible');
        conforms(container, 'toggle-group');
    });

    it('refuses an item valued "" in single mode', () => {
        expect(() => render(
            <ToggleGroup.Root>
                <ToggleGroup.Item value=""><text>none</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        )).toThrow(/reserved/);
    });
});
