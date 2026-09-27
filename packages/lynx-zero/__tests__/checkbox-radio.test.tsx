/**
 * Wave 2 / W2A (#1203, epic #1140): Checkbox, CheckboxGroup and RadioGroup
 * on the zero 0.6+ anatomy. Every state the tests drive is held to BOTH
 * oracles (anatomy + class grammar) — checked / unchecked / indeterminate,
 * the forced interaction flags, invalid / required / readonly / disabled,
 * group membership, the tri-state parent box and data-mode radios.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Define } from '@sigx/lynx';
import { component, signal } from '@sigx/lynx';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { provideFieldContext } from '@sigx/zero/behaviors/core';
import { Checkbox, CheckboxGroup, RadioGroup } from '../src/index';
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
const byPart = (root: TestNode, scope: string, part: string, index = 0): TestNode => {
    const found = allParts(root, scope, part)[index];
    if (!found) throw new Error(`no ${scope}.${part}[${index}]`);
    return found;
};
const states = (root: TestNode, scope: string, part: string): unknown[] =>
    allParts(root, scope, part).map((n) => n.props['data-state']);

/** Microtask flush: group registration is deferred a tick. */
const settle = (): Promise<void> => act(async () => { await Promise.resolve(); await Promise.resolve(); });

type FieldProps = Define.Prop<'disabled', boolean, false> & Define.Prop<'readonly', boolean, false>
    & Define.Prop<'invalid', boolean, false> & Define.Prop<'size', string, false> & Define.Slot<'default'>;
/** A bare Field context, as `Field.Root` would provide it. */
const TestField = component<FieldProps>(({ props, slots }) => {
    provideFieldContext({
        inert: false,
        ids: { control: 'c', label: 'l', description: 'd', error: 'e' },
        disabled: () => !!props.disabled,
        invalid: () => !!props.invalid,
        required: () => false,
        readonly: () => !!props.readonly,
        size: () => props.size,
        describedBy: () => undefined,
    });
    return () => slots.default?.();
}, { name: 'TestField' });

describe('Checkbox', () => {
    it('toggles on tap, reports checkedChange, and conforms in both states', async () => {
        const changes: boolean[] = [];
        const { container } = render(<Checkbox.Root label="Terms" onCheckedChange={(v: boolean) => changes.push(v)}>Accept</Checkbox.Root>);
        const root = byPart(container, 'checkbox', 'root');
        expect(root.props['data-state']).toBe('unchecked');
        expect(root.props['accessibility-status']).toBe('unchecked');
        conforms(container, 'checkbox');
        await act(() => fireEvent.tap(root as never));
        expect(changes).toEqual([true]);
        expect(states(container, 'checkbox', 'root')).toEqual(['checked']);
        expect(states(container, 'checkbox', 'indicator')).toEqual(['checked']);
        expect(byPart(container, 'checkbox', 'control')._class).toContain('zx-s-checked');
        expect(byPart(container, 'checkbox', 'root').props['accessibility-status']).toBe('checked');
        conforms(container, 'checkbox');
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root') as never));
        expect(changes).toEqual([true, false]);
    });

    it('a `value` prop does not swallow checkedChange (runtime-core emit collision guard)', async () => {
        const changes: boolean[] = [];
        const { container } = render(<Checkbox.Root value="news" onCheckedChange={(v: boolean) => changes.push(v)} />);
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root') as never));
        expect(changes).toEqual([true]);
    });

    it('stamps the resolved axes on every part and the label part carries the slot', () => {
        const { container } = render(<Checkbox.Root color="secondary" size="lg">Label</Checkbox.Root>);
        for (const part of ['root', 'control', 'indicator', 'label']) {
            const node = byPart(container, 'checkbox', part);
            expect(node._class).toContain('zx-a-color-secondary');
            expect(node._class).toContain('zx-a-size-lg');
        }
        conforms(container, 'checkbox');
    });

    it('hideLabel renders no label part', () => {
        const { container } = render(<Checkbox.Root hideLabel label="Row 1">Hidden</Checkbox.Root>);
        expect(allParts(container, 'checkbox', 'label')).toHaveLength(0);
        expect(byPart(container, 'checkbox', 'root').props['accessibility-label']).toBe('Row 1');
        conforms(container, 'checkbox');
    });

    it('indeterminate renders the mixed state on every part and announces it', async () => {
        const { container } = render(<Checkbox.Root indeterminate>Some</Checkbox.Root>);
        expect(states(container, 'checkbox', 'root')).toEqual(['indeterminate']);
        expect(states(container, 'checkbox', 'control')).toEqual(['indeterminate']);
        expect(states(container, 'checkbox', 'indicator')).toEqual(['indeterminate']);
        expect(byPart(container, 'checkbox', 'root').props['accessibility-status']).toBe('mixed');
        conforms(container, 'checkbox');
    });

    it('readonly: announced, no press, no toggle', async () => {
        const changes: boolean[] = [];
        const { container } = render(<Checkbox.Root readonly defaultChecked onCheckedChange={(v: boolean) => changes.push(v)} />);
        const root = byPart(container, 'checkbox', 'root');
        expect(root._class).toContain('zx-f-readonly');
        expect(byPart(container, 'checkbox', 'control')._class).toContain('zx-f-readonly');
        await act(() => fireEvent.touchStart(root as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'checkbox', 'control')._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(root as never));
        await act(() => fireEvent.tap(root as never));
        expect(changes).toEqual([]);
        expect(byPart(container, 'checkbox', 'root').props['accessibility-status']).toBe('checked, read only');
        conforms(container, 'checkbox');
    });

    it('disabled: no press, no toggle', async () => {
        const changes: boolean[] = [];
        const { container } = render(<Checkbox.Root disabled onCheckedChange={(v: boolean) => changes.push(v)} />);
        const root = byPart(container, 'checkbox', 'root');
        await act(() => fireEvent.touchStart(root as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'checkbox', 'control')._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(root as never));
        await act(() => fireEvent.tap(root as never));
        expect(changes).toEqual([]);
        expect(root._class).toContain('zx-f-disabled');
        conforms(container, 'checkbox');
    });

    it('pressed lands on the control while held', async () => {
        const { container } = render(<Checkbox.Root />);
        const root = byPart(container, 'checkbox', 'root');
        await act(() => fireEvent.touchStart(root as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'checkbox', 'control')._class).toContain('zx-f-pressed');
        expect(root._class).not.toContain('zx-f-pressed');
        conforms(container, 'checkbox');
        await act(() => fireEvent.touchEnd(root as never));
        expect(byPart(container, 'checkbox', 'control')._class).not.toContain('zx-f-pressed');
    });

    it('invalid + required + forced pressed/focus-visible conform together', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Checkbox.Root invalid required defaultChecked>Label</Checkbox.Root>
            </ForceStates>,
        );
        const control = byPart(container, 'checkbox', 'control');
        expect(control._class).toContain('zx-f-pressed');
        expect(control._class).toContain('zx-f-focus-visible');
        expect(control._class).toContain('zx-f-invalid');
        expect(byPart(container, 'checkbox', 'root')._class).toContain('zx-f-required');
        conforms(container, 'checkbox');
    });

    it('array mode: boxes sharing a string[] model toggle their own membership', async () => {
        const store = signal({ tags: ['a'] as string[] });
        const { container } = render(
            <view>
                <Checkbox.Root model={() => store.tags} value="a">A</Checkbox.Root>
                <Checkbox.Root model={() => store.tags} value="b">B</Checkbox.Root>
            </view>,
        );
        expect(states(container, 'checkbox', 'root')).toEqual(['checked', 'unchecked']);
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 1) as never));
        expect([...store.tags]).toEqual(['a', 'b']);
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 0) as never));
        expect([...store.tags]).toEqual(['b']);
        expect(states(container, 'checkbox', 'root')).toEqual(['unchecked', 'checked']);
    });

    it('adopts a Field\'s disabled / readonly / invalid / size', () => {
        const { container } = render(
            <TestField readonly invalid size="xs"><Checkbox.Root /></TestField>,
        );
        const root = byPart(container, 'checkbox', 'root');
        expect(root._class).toContain('zx-f-readonly');
        expect(root._class).toContain('zx-f-invalid');
        expect(root._class).toContain('zx-a-size-xs');
        conforms(container, 'checkbox');
    });
});

describe('CheckboxGroup', () => {
    // `model={() => …}` is compiled into a binding at the JSX site, so the
    // store is passed in and bound here, not forwarded as a function.
    const Toppings = (props: { store?: { v: string[] }; readonly?: boolean; disabled?: boolean; allValues?: string[]; onValueChange?: (v: string[]) => void; parentChange?: (v: boolean) => void }) => {
        const store = props.store ?? signal({ v: [] as string[] });
        return (
        <CheckboxGroup.Root
            model={() => store.v}
            readonly={props.readonly}
            disabled={props.disabled}
            allValues={props.allValues}
            onValueChange={props.onValueChange}
            color="secondary"
            size="lg"
            orientation="horizontal"
        >
            <CheckboxGroup.Label>Toppings</CheckboxGroup.Label>
            <Checkbox.Root parent onCheckedChange={props.parentChange}>All</Checkbox.Root>
            <Checkbox.Root value="ham">Ham</Checkbox.Root>
            <Checkbox.Root value="olives">Olives</Checkbox.Root>
            <Checkbox.Root value="basil">Basil</Checkbox.Root>
        </CheckboxGroup.Root>
        );
    };

    it('children follow the group model; the parent box derives all / some / none', async () => {
        const store = signal({ v: ['ham'] as string[] });
        const changes: string[][] = [];
        const { container } = render(<Toppings store={store} onValueChange={(v) => changes.push([...v])} />);
        await settle();
        expect(states(container, 'checkbox', 'root')).toEqual(['indeterminate', 'checked', 'unchecked', 'unchecked']);
        conforms(container, 'checkbox');
        conforms(container, 'checkbox-group');

        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 2) as never));
        expect([...store.v]).toEqual(['ham', 'olives']);
        expect(changes.at(-1)).toEqual(['ham', 'olives']);

        // Parent: some → all.
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 0) as never));
        expect([...store.v].sort()).toEqual(['basil', 'ham', 'olives']);
        expect(states(container, 'checkbox', 'root')).toEqual(['checked', 'checked', 'checked', 'checked']);
        // Parent: all → none.
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 0) as never));
        expect([...store.v]).toEqual([]);
        expect(states(container, 'checkbox', 'root')).toEqual(['unchecked', 'unchecked', 'unchecked', 'unchecked']);
        conforms(container, 'checkbox');
    });

    it('the parent box reports its own state through checkedChange', async () => {
        const parent: boolean[] = [];
        const { container } = render(<Toppings parentChange={(v) => parent.push(v)} />);
        await settle();
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 0) as never));
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 0) as never));
        expect(parent).toEqual([true, false]);
    });

    it('allValues narrows what the parent box selects', async () => {
        const store = signal({ v: [] as string[] });
        const { container } = render(<Toppings store={store} allValues={['ham', 'basil']} />);
        await settle();
        await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 0) as never));
        expect([...store.v]).toEqual(['ham', 'basil']);
        expect(states(container, 'checkbox', 'root')).toEqual(['checked', 'checked', 'unchecked', 'checked']);
    });

    it('stamps orientation + its axes on the root, and the label reads the group axes', async () => {
        const { container } = render(<Toppings />);
        await settle();
        const root = byPart(container, 'checkbox-group', 'root');
        expect(root._class).toContain('zx-o-horizontal');
        expect(root._class).toContain('zx-a-color-secondary');
        expect(byPart(container, 'checkbox-group', 'label')._class).toContain('zx-a-color-secondary');
        // The group's size reaches the boxes; its colour does not.
        const box = byPart(container, 'checkbox', 'control', 1);
        expect(box._class).toContain('zx-a-size-lg');
        expect(box._class).not.toContain('zx-a-color-secondary');
        conforms(container, 'checkbox-group');
    });

    it('group readonly / disabled reach every box and refuse taps', async () => {
        for (const flag of ['readonly', 'disabled'] as const) {
            const store = signal({ v: ['ham'] as string[] });
            const { container, unmount } = render(<Toppings store={store} {...{ [flag]: true }} />);
            await settle();
            for (const node of allParts(container, 'checkbox', 'root')) expect(node._class).toContain(`zx-f-${flag}`);
            expect(byPart(container, 'checkbox-group', 'root')._class).toContain(`zx-f-${flag}`);
            await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 2) as never));
            await act(() => fireEvent.tap(byPart(container, 'checkbox', 'root', 0) as never));
            expect([...store.v]).toEqual(['ham']);
            conforms(container, 'checkbox');
            conforms(container, 'checkbox-group');
            unmount();
        }
    });

    it('invalid + required flag the root and label; a Field\'s flags reach the group once', async () => {
        const { container } = render(
            <TestField invalid>
                <CheckboxGroup.Root required>
                    <CheckboxGroup.Label>Pick</CheckboxGroup.Label>
                    <Checkbox.Root value="a">A</Checkbox.Root>
                </CheckboxGroup.Root>
            </TestField>,
        );
        await settle();
        const label = byPart(container, 'checkbox-group', 'label');
        expect(label._class).toContain('zx-f-invalid');
        expect(label._class).toContain('zx-f-required');
        expect(byPart(container, 'checkbox', 'root')._class).toContain('zx-f-invalid');
        conforms(container, 'checkbox-group');
        conforms(container, 'checkbox');
    });

    it('warns once per box that has no value', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<CheckboxGroup.Root><Checkbox.Root>No value</Checkbox.Root></CheckboxGroup.Root>);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('RadioGroup', () => {
    it('selects on tap, never unchecks, and conforms', async () => {
        const changes: string[] = [];
        const { container } = render(
            <RadioGroup.Root defaultValue="free" onValueChange={(v: string) => changes.push(v)} color="accent" size="sm">
                <RadioGroup.Label>Plan</RadioGroup.Label>
                <RadioGroup.Item value="free">Free</RadioGroup.Item>
                <RadioGroup.Item value="pro" label="Pro plan">Pro</RadioGroup.Item>
            </RadioGroup.Root>,
        );
        expect(states(container, 'radio-group', 'item')).toEqual(['checked', 'unchecked']);
        expect(states(container, 'radio-group', 'item-indicator')).toEqual(['checked', 'unchecked']);
        conforms(container, 'radio-group');
        await act(() => fireEvent.tap(byPart(container, 'radio-group', 'item', 1) as never));
        expect(changes).toEqual(['pro']);
        expect(states(container, 'radio-group', 'item')).toEqual(['unchecked', 'checked']);
        expect(byPart(container, 'radio-group', 'item', 1).props['accessibility-status']).toBe('checked');
        expect(byPart(container, 'radio-group', 'item', 1).props['accessibility-label']).toBe('Pro plan');
        // Tapping the checked item is a no-op.
        await act(() => fireEvent.tap(byPart(container, 'radio-group', 'item', 1) as never));
        expect(changes).toEqual(['pro']);
        for (const part of ['item', 'item-control', 'item-indicator', 'item-label', 'label']) {
            expect(byPart(container, 'radio-group', part)._class).toContain('zx-a-color-accent');
            expect(byPart(container, 'radio-group', part)._class).toContain('zx-a-size-sm');
        }
        conforms(container, 'radio-group');
    });

    it('binds a controlled model', async () => {
        const store = signal({ plan: 'pro' });
        const { container } = render(
            <RadioGroup.Root model={() => store.plan}>
                <RadioGroup.Item value="free">Free</RadioGroup.Item>
                <RadioGroup.Item value="pro">Pro</RadioGroup.Item>
            </RadioGroup.Root>,
        );
        expect(states(container, 'radio-group', 'item')).toEqual(['unchecked', 'checked']);
        await act(() => fireEvent.tap(byPart(container, 'radio-group', 'item', 0) as never));
        expect(store.plan).toBe('free');
        await act(() => { store.plan = 'pro'; });
        expect(states(container, 'radio-group', 'item')).toEqual(['unchecked', 'checked']);
    });

    it('pressed lands on the item-control; disabled items neither press nor select', async () => {
        const { container } = render(
            <RadioGroup.Root>
                <RadioGroup.Item value="a">A</RadioGroup.Item>
                <RadioGroup.Item value="b" disabled>B</RadioGroup.Item>
            </RadioGroup.Root>,
        );
        const a = byPart(container, 'radio-group', 'item', 0);
        await act(() => fireEvent.touchStart(a as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'radio-group', 'item-control', 0)._class).toContain('zx-f-pressed');
        conforms(container, 'radio-group');
        await act(() => fireEvent.touchEnd(a as never));
        const b = byPart(container, 'radio-group', 'item', 1);
        await act(() => fireEvent.touchStart(b as never, { touches: [touch(1, 1)] }));
        expect(byPart(container, 'radio-group', 'item-control', 1)._class).not.toContain('zx-f-pressed');
        await act(() => fireEvent.touchEnd(b as never));
        await act(() => fireEvent.tap(b as never));
        expect(states(container, 'radio-group', 'item')).toEqual(['unchecked', 'unchecked']);
        expect(byPart(container, 'radio-group', 'item-label', 1)._class).toContain('zx-f-disabled');
    });

    it('readonly / invalid are restated on each item and item-control; readonly refuses taps', async () => {
        const { container } = render(
            <RadioGroup.Root readonly invalid required defaultValue="a" orientation="horizontal">
                <RadioGroup.Label>Pick</RadioGroup.Label>
                <RadioGroup.Item value="a">A</RadioGroup.Item>
                <RadioGroup.Item value="b">B</RadioGroup.Item>
            </RadioGroup.Root>,
        );
        for (const part of ['item', 'item-control']) {
            for (const node of allParts(container, 'radio-group', part)) {
                expect(node._class).toContain('zx-f-readonly');
                expect(node._class).toContain('zx-f-invalid');
            }
        }
        expect(byPart(container, 'radio-group', 'root')._class).toContain('zx-o-horizontal');
        expect(byPart(container, 'radio-group', 'label')._class).toContain('zx-f-required');
        await act(() => fireEvent.tap(byPart(container, 'radio-group', 'item', 1) as never));
        expect(states(container, 'radio-group', 'item')).toEqual(['checked', 'unchecked']);
        expect(byPart(container, 'radio-group', 'item', 0).props['accessibility-status']).toBe('checked, read only');
        conforms(container, 'radio-group');
    });

    it('forced pressed / focus-visible land on item + item-control', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <RadioGroup.Root defaultValue="a">
                    <RadioGroup.Item value="a">A</RadioGroup.Item>
                </RadioGroup.Root>
            </ForceStates>,
        );
        const control = byPart(container, 'radio-group', 'item-control');
        expect(control._class).toContain('zx-f-pressed');
        expect(control._class).toContain('zx-f-focus-visible');
        expect(byPart(container, 'radio-group', 'item')._class).toContain('zx-f-focus-visible');
        expect(byPart(container, 'radio-group', 'item')._class).not.toContain('zx-f-pressed');
        conforms(container, 'radio-group');
    });

    it('data mode: one item per entry, keyed and labelled by the collection accessors', async () => {
        const plans = [
            { id: 'free', name: 'Free' },
            { id: 'pro', name: 'Pro' },
            { id: 'team', name: 'Team', disabled: true },
        ];
        const changes: string[] = [];
        const { container } = render(
            <RadioGroup.Root
                items={plans}
                itemKey={(p) => p.id}
                itemLabel={(p) => p.name}
                onValueChange={(v: string) => changes.push(v)}
            />,
        );
        expect(allParts(container, 'radio-group', 'item')).toHaveLength(3);
        expect(byPart(container, 'radio-group', 'item', 2)._class).toContain('zx-f-disabled');
        await act(() => fireEvent.tap(byPart(container, 'radio-group', 'item', 1) as never));
        expect(changes).toEqual(['pro']);
        conforms(container, 'radio-group');
    });

    it('adopts a Field\'s disabled', async () => {
        const { container } = render(
            <TestField disabled>
                <RadioGroup.Root>
                    <RadioGroup.Item value="a">A</RadioGroup.Item>
                </RadioGroup.Root>
            </TestField>,
        );
        expect(byPart(container, 'radio-group', 'root')._class).toContain('zx-f-disabled');
        await act(() => fireEvent.tap(byPart(container, 'radio-group', 'item') as never));
        expect(states(container, 'radio-group', 'item')).toEqual(['unchecked']);
    });
});
