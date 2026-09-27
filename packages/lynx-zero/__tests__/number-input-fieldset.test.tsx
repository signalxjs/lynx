/**
 * Wave 2D (#1202, epic #1140): NumberInput and Fieldset on the zero 0.11
 * anatomy. Every rendered state is held to BOTH oracles (anatomy + class
 * grammar); the stepping math is zero's, pinned here against the port.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import { Fieldset, NumberInput } from '../src/index';
import { clamp, parseDecimal, precisionOf, snapToStep, stepToward } from '../src/components/number-input/number';
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
const nip = (root: TestNode, part: string): TestNode => byPart(root, 'number-input', part);

const fire = (node: TestNode, key: string, event: unknown = {}): void => {
    const handler = (node as unknown as { _handlers: Map<string, (e: unknown) => void> })._handlers.get(key);
    if (!handler) throw new Error(`no ${key} handler`);
    handler(event);
};
const type = (input: TestNode, value: string): void => fire(input, 'bindinput', { detail: { value } });

interface NIProps {
    [key: string]: unknown;
}

const Full = (p: NIProps) => (
    <NumberInput.Root {...(p as object)}>
        <NumberInput.Label>Qty</NumberInput.Label>
        <NumberInput.Control>
            <NumberInput.DecrementTrigger />
            <NumberInput.Input placeholder="0" />
            <NumberInput.IncrementTrigger />
        </NumberInput.Control>
    </NumberInput.Root>
);

describe('number math (zero port)', () => {
    it('snaps on a min-anchored grid without float noise', () => {
        expect(precisionOf(0.25)).toBe(2);
        expect(precisionOf(1e-7)).toBe(7);
        expect(snapToStep(0.1 + 0.2, 0.1)).toBe(0.3);
        expect(snapToStep(0.35, 0.1)).toBe(0.4);
        expect(snapToStep(4, 2, 1)).toBe(5);
        expect(clamp(12, 0, 10)).toBe(10);
        expect(clamp(-1, 0)).toBe(0);
    });

    it('steps off-grid values to the neighbour in the direction of travel', () => {
        expect(stepToward(5, 1, 2)).toBe(6);
        expect(stepToward(5, -1, 2)).toBe(4);
        expect(stepToward(4, 1, 2)).toBe(6);
        expect(stepToward(0.3, 1, 0.1)).toBe(0.4);
    });

    it('parses decimal syntax only', () => {
        expect(parseDecimal(' 12.5 ')).toBe(12.5);
        expect(parseDecimal('-3')).toBe(-3);
        expect(parseDecimal('1e3')).toBe(1000);
        expect(parseDecimal('0x10')).toBeNull();
        expect(parseDecimal('-')).toBeNull();
        expect(parseDecimal('')).toBeNull();
    });
});

describe('NumberInput', () => {
    it('renders the zero anatomy and conforms', () => {
        const { container } = render(<Full defaultValue={3} label="Quantity" />);
        const input = nip(container, 'input');
        expect(input.props['value']).toBe('3');
        expect(input.props['accessibility-label']).toBe('Quantity');
        expect(input.props['placeholder']).toBe('0');
        expect(nip(container, 'increment-trigger').props['accessibility-label']).toBe('Increment');
        expect(nip(container, 'decrement-trigger').props['accessibility-label']).toBe('Decrement');
        conforms(container, 'number-input');
    });

    it('omits unset optional strings (no NSNull on iOS)', () => {
        const { container } = render(
            <NumberInput.Root>
                <NumberInput.Control><NumberInput.Input /></NumberInput.Control>
            </NumberInput.Root>,
        );
        const input = nip(container, 'input');
        expect('placeholder' in input.props).toBe(false);
        expect('accessibility-label' in input.props).toBe(false);
        expect(input.props['value']).toBe('');
    });

    it('picks the digit keypad only when negatives are impossible', () => {
        const { container: a } = render(<Full min={0} />);
        expect(nip(a, 'input').props['type']).toBe('digit');
        const { container: b } = render(<Full min={-5} />);
        expect(nip(b, 'input').props['type']).toBe('number');
        const { container: c } = render(<Full />);
        expect(nip(c, 'input').props['type']).toBe('number');
    });

    it('steps with the triggers, clamps at the bounds and disables the spent trigger', async () => {
        const changes: Array<number | null> = [];
        const { container } = render(
            <Full defaultValue={8} min={0} max={10} step={2} onValueChange={(v: number | null) => changes.push(v)} />,
        );
        await act(() => fireEvent.tap(nip(container, 'increment-trigger')));
        expect(changes).toEqual([10]);
        expect(nip(container, 'input').props['value']).toBe('10');
        const inc = nip(container, 'increment-trigger');
        expect(inc._class).toContain('zx-f-disabled');
        expect(inc.props['accessibility-status']).toBe('disabled');
        await act(() => fireEvent.tap(inc));
        expect(changes).toEqual([10]);
        await act(() => fireEvent.tap(nip(container, 'decrement-trigger')));
        expect(changes).toEqual([10, 8]);
        conforms(container, 'number-input');
    });

    it('steps from empty onto the floor of the range', async () => {
        const changes: Array<number | null> = [];
        const { container } = render(<Full min={5} onValueChange={(v: number | null) => changes.push(v)} />);
        await act(() => fireEvent.tap(nip(container, 'increment-trigger')));
        expect(changes).toEqual([5]);
    });

    it('typing is a draft; blur commits (parse → snap → clamp)', async () => {
        const changes: Array<number | null> = [];
        const { container } = render(
            <Full defaultValue={1} min={0} max={50} step={5} onValueChange={(v: number | null) => changes.push(v)} />,
        );
        const input = nip(container, 'input');
        await act(() => type(input, '2'));
        await act(() => type(input, '23'));
        expect(changes).toEqual([]);
        expect(nip(container, 'input').props['value']).toBe('23');
        await act(() => fire(input, 'bindblur'));
        expect(changes).toEqual([25]);
        expect(nip(container, 'input').props['value']).toBe('25');
        await act(() => type(input, '999'));
        await act(() => fire(input, 'bindconfirm'));
        expect(changes).toEqual([25, 50]);
    });

    it('unparseable text reverts; empty text commits null', async () => {
        const changes: Array<number | null> = [];
        const { container } = render(<Full defaultValue={7} onValueChange={(v: number | null) => changes.push(v)} />);
        const input = nip(container, 'input');
        await act(() => type(input, '-'));
        await act(() => fire(input, 'bindblur'));
        expect(changes).toEqual([]);
        expect(nip(container, 'input').props['value']).toBe('7');
        await act(() => type(input, ''));
        await act(() => fire(input, 'bindblur'));
        expect(changes).toEqual([null]);
        expect(nip(container, 'input').props['value']).toBe('');
    });

    it('a trigger commits a pending draft before stepping', async () => {
        const changes: Array<number | null> = [];
        const { container } = render(<Full defaultValue={1} onValueChange={(v: number | null) => changes.push(v)} />);
        await act(() => type(nip(container, 'input'), '40'));
        await act(() => fireEvent.tap(nip(container, 'increment-trigger')));
        expect(changes).toEqual([40, 41]);
    });

    it('binds a model two-way and honours format / parse', async () => {
        const state = signal({ qty: 1500 as number | null });
        const { container } = render(
            <NumberInput.Root
                model={() => state.qty}
                format={(v: number) => `$${v}`}
                parse={(t: string) => parseDecimal(t.replace('$', ''))}
                step={100}
            >
                <NumberInput.Control>
                    <NumberInput.Input />
                    <NumberInput.IncrementTrigger />
                </NumberInput.Control>
            </NumberInput.Root>,
        );
        expect(nip(container, 'input').props['value']).toBe('$1500');
        await act(() => fireEvent.tap(nip(container, 'increment-trigger')));
        expect(state.qty).toBe(1600);
        await act(() => type(nip(container, 'input'), '$20'));
        await act(() => fire(nip(container, 'input'), 'bindblur'));
        expect(state.qty).toBe(0);
        await act(() => {
            state.qty = 300;
        });
        expect(nip(container, 'input').props['value']).toBe('$300');
    });

    it('native focus drives focus-visible on control + input', async () => {
        const { container } = render(<Full />);
        await act(() => fire(nip(container, 'input'), 'bindfocus'));
        expect(nip(container, 'control')._class).toContain('zx-f-focus-visible');
        expect(nip(container, 'input')._class).toContain('zx-f-focus-visible');
        conforms(container, 'number-input');
        await act(() => fire(nip(container, 'input'), 'bindblur'));
        expect(nip(container, 'control')._class).not.toContain('zx-f-focus-visible');
    });

    it('marks an out-of-range committed value invalid', () => {
        const { container } = render(<Full defaultValue={20} max={10} />);
        for (const part of ['root', 'label', 'control', 'input']) {
            expect(nip(container, part)._class, part).toContain('zx-f-invalid');
        }
        conforms(container, 'number-input');
    });

    it('readonly and disabled refuse typing and stepping and show no press', async () => {
        for (const flag of ['readonly', 'disabled'] as const) {
            const changes: Array<number | null> = [];
            const { container } = render(<Full defaultValue={2} {...{ [flag]: true }} onValueChange={(v: number | null) => changes.push(v)} />);
            const inc = nip(container, 'increment-trigger');
            expect(inc._class).toContain('zx-f-disabled');
            await act(() => fireEvent.touchStart(inc, { touches: [touch(1, 1)] }));
            expect(nip(container, 'increment-trigger')._class).not.toContain('zx-f-pressed');
            await act(() => fireEvent.touchEnd(inc));
            await act(() => fireEvent.tap(inc));
            await act(() => type(nip(container, 'input'), '9'));
            await act(() => fire(nip(container, 'input'), 'bindblur'));
            expect(changes, flag).toEqual([]);
            expect(nip(container, 'input').props[flag], flag).toBe(true);
            expect(nip(container, 'root')._class).toContain(`zx-f-${flag}`);
            conforms(container, 'number-input');
        }
    });

    it('a pressed trigger stamps pressed on that trigger only', async () => {
        const { container } = render(<Full defaultValue={1} />);
        await act(() => fireEvent.touchStart(nip(container, 'increment-trigger'), { touches: [touch(1, 1)] }));
        expect(nip(container, 'increment-trigger')._class).toContain('zx-f-pressed');
        expect(nip(container, 'decrement-trigger')._class).not.toContain('zx-f-pressed');
        conforms(container, 'number-input');
        await act(() => fireEvent.touchEnd(nip(container, 'increment-trigger')));
        expect(nip(container, 'increment-trigger')._class).not.toContain('zx-f-pressed');
    });

    it('stamps the resolved axes on every part', () => {
        const { container } = render(<Full color="secondary" size="lg" />);
        for (const part of ['root', 'label', 'control', 'input', 'increment-trigger', 'decrement-trigger']) {
            const cls = nip(container, part)._class;
            expect(cls, part).toContain('zx-a-color-secondary');
            expect(cls, part).toContain('zx-a-size-lg');
        }
    });

    it('ForceStates reaches every declared part and the tree still conforms', () => {
        const { container } = render(
            <ForceStates flags={{ pressed: true, 'focus-visible': true }}>
                <Full defaultValue={1} />
            </ForceStates>,
        );
        expect(nip(container, 'control')._class).toContain('zx-f-focus-visible');
        expect(nip(container, 'input')._class).toContain('zx-f-focus-visible');
        expect(nip(container, 'increment-trigger')._class).toContain('zx-f-pressed');
        expect(nip(container, 'root')._class).not.toContain('zx-f-pressed');
        conforms(container, 'number-input');
    });

    it('custom trigger content replaces the glyph', () => {
        const { container } = render(
            <NumberInput.Root>
                <NumberInput.Control>
                    <NumberInput.IncrementTrigger label="More"><text>up</text></NumberInput.IncrementTrigger>
                </NumberInput.Control>
            </NumberInput.Root>,
        );
        const inc = nip(container, 'increment-trigger');
        expect(inc.props['accessibility-label']).toBe('More');
        expect(JSON.stringify(inc.children.map((c) => c.children.map((t) => t.props['text'] ?? t.text)))).toContain('up');
    });

    describe('long-press spin', () => {
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('repeats until the touch ends and swallows the trailing tap', async () => {
            const changes: Array<number | null> = [];
            const { container } = render(
                <Full defaultValue={0} max={100} spinInterval={50} onValueChange={(v: number | null) => changes.push(v)} />,
            );
            const inc = nip(container, 'increment-trigger');
            await act(() => fireEvent.touchStart(inc, { touches: [touch(1, 1)] }));
            await act(() => fireEvent.longPress(inc));
            expect(changes).toEqual([1]);
            await act(() => {
                vi.advanceTimersByTime(160);
            });
            expect(changes).toEqual([1, 2, 3, 4]);
            await act(() => fireEvent.touchEnd(inc));
            await act(() => fireEvent.tap(inc));
            await act(() => {
                vi.advanceTimersByTime(200);
            });
            expect(changes).toEqual([1, 2, 3, 4]);
            // The next plain tap steps again.
            await act(() => fireEvent.touchStart(inc, { touches: [touch(1, 1)] }));
            await act(() => fireEvent.touchEnd(inc));
            await act(() => fireEvent.tap(inc));
            expect(changes).toEqual([1, 2, 3, 4, 5]);
        });

        it('stops at the bound', async () => {
            const changes: Array<number | null> = [];
            const { container } = render(
                <Full defaultValue={8} max={10} spinInterval={50} onValueChange={(v: number | null) => changes.push(v)} />,
            );
            const inc = nip(container, 'increment-trigger');
            await act(() => fireEvent.touchStart(inc, { touches: [touch(1, 1)] }));
            await act(() => fireEvent.longPress(inc));
            await act(() => {
                vi.advanceTimersByTime(500);
            });
            expect(changes).toEqual([9, 10]);
        });
    });
});

describe('Fieldset', () => {
    it('renders root + legend and conforms', () => {
        const { container } = render(
            <Fieldset.Root color="primary" size="sm">
                <Fieldset.Legend>Shipping</Fieldset.Legend>
            </Fieldset.Root>,
        );
        const root = byPart(container, 'fieldset', 'root');
        const legend = byPart(container, 'fieldset', 'legend');
        expect(root._class).toContain('zx-a-color-primary');
        expect(legend._class).toContain('zx-a-size-sm');
        conforms(container, 'fieldset');
    });

    it('stamps its flags on root and legend', () => {
        const { container } = render(
            <Fieldset.Root disabled readonly invalid>
                <Fieldset.Legend>Locked</Fieldset.Legend>
            </Fieldset.Root>,
        );
        const root = byPart(container, 'fieldset', 'root');
        for (const f of ['disabled', 'readonly', 'invalid']) expect(root._class).toContain(`zx-f-${f}`);
        const legend = byPart(container, 'fieldset', 'legend');
        expect(legend._class).toContain('zx-f-disabled');
        expect(legend._class).toContain('zx-f-invalid');
        expect(legend._class).not.toContain('zx-f-readonly');
        conforms(container, 'fieldset');
    });

    it('reaches a NumberInput inside: disabled, readonly and invalid', async () => {
        for (const flag of ['disabled', 'readonly', 'invalid'] as const) {
            const changes: Array<number | null> = [];
            const { container } = render(
                <Fieldset.Root {...{ [flag]: true }}>
                    <Fieldset.Legend>Group</Fieldset.Legend>
                    <Full defaultValue={1} onValueChange={(v: number | null) => changes.push(v)} />
                </Fieldset.Root>,
            );
            expect(nip(container, 'root')._class, flag).toContain(`zx-f-${flag}`);
            await act(() => fireEvent.tap(nip(container, 'increment-trigger')));
            expect(changes, flag).toEqual(flag === 'invalid' ? [2] : []);
            conforms(container, 'number-input');
            conforms(container, 'fieldset');
        }
    });

    it('nested fieldsets chain up, reactively', async () => {
        const state = signal({ locked: false });
        const Host = component(() => () => (
            <Fieldset.Root disabled={state.locked}>
                <Fieldset.Root>
                    <Full defaultValue={1} />
                </Fieldset.Root>
            </Fieldset.Root>
        ));
        const { container } = render(<Host />);
        expect(nip(container, 'root')._class).not.toContain('zx-f-disabled');
        await act(() => {
            state.locked = true;
        });
        expect(nip(container, 'root')._class).toContain('zx-f-disabled');
        const inner = allParts(container, 'fieldset', 'root')[1]!;
        expect(inner._class).toContain('zx-f-disabled');
    });

    it('the legend exempts its own content from the fieldset (outer context)', () => {
        const { container } = render(
            <Fieldset.Root disabled>
                <Fieldset.Legend>
                    <Full defaultValue={1} />
                </Fieldset.Legend>
            </Fieldset.Root>,
        );
        expect(nip(container, 'root')._class).not.toContain('zx-f-disabled');
    });
});
