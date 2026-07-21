/**
 * Plain-prop change callbacks for the model-only form controls (#336).
 *
 * `Select` and `Radio.Item` can't route these through `emit`: both take a
 * prop named `value`, which shadows `@sigx/runtime-core`'s emit handler
 * lookup so events never fire (#323). They're plain function props instead —
 * these tests drive a real press through to the callback.
 *
 * Two main-thread seams are stubbed because the BG test harness cannot run
 * them, NOT because the components are mocked: `Pressable` (a gesture
 * recognizer that lives on the MT) becomes a plain view with `bindtap`, and
 * `runOnBackground` — which the SWC worklet transform normally rewrites at
 * build time — becomes a direct call. Everything under test is the real
 * component code.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act, type TestNode } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';

vi.mock('@sigx/lynx-gestures', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx-gestures')>();
    const { component } = await import('@sigx/lynx');
    const { jsx } = await import('@sigx/lynx/jsx-runtime');
    const Pressable = (component as (setup: (ctx: never) => () => unknown) => unknown)(
        (({ props, slots }: { props: Record<string, unknown>; slots: { default?: () => unknown } }) => () =>
            jsx('view', {
                class: props.class,
                style: props.style,
                bindtap: () => (props.onPress as (() => void) | undefined)?.(),
                children: slots.default?.() as never,
            })) as never,
    );
    return { ...actual, Pressable };
});

vi.mock('@sigx/lynx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx')>();
    return {
        ...actual,
        runOnBackground: (fn: (...a: unknown[]) => unknown) => (...args: unknown[]) => fn(...args),
    };
});

const { Radio } = await import('../src/forms/Radio');
const { Select } = await import('../src/forms/Select');

const find = (n: TestNode, pred: (n: TestNode) => boolean): TestNode | null => {
    if (pred(n)) return n;
    for (const c of n.children ?? []) {
        const hit = find(c, pred);
        if (hit) return hit;
    }
    return null;
};

const tappable = (root: TestNode, cls?: string): TestNode => {
    const hit = find(root, (n) =>
        Boolean(n._handlers?.has('bindtap')) && (cls ? Boolean(n._class?.includes(cls)) : true));
    if (!hit) throw new Error(`no tappable node${cls ? ` with class ${cls}` : ''}`);
    return hit;
};

/** Every tappable node, document order — one per rendered item. */
const allTappable = (root: TestNode): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n._handlers?.has('bindtap')) out.push(n);
        for (const c of n.children ?? []) walk(c);
    };
    walk(root);
    return out;
};

/** Open the dropdown through the component's own main-thread tap handler. */
const openSelect = async (root: TestNode): Promise<void> => {
    const trigger = find(root, (n) => typeof n.props?.['main-thread:bindtap'] === 'function');
    if (!trigger) throw new Error('no select trigger');
    await act(() => { (trigger.props['main-thread:bindtap'] as () => void)(); });
};

const OPTIONS = [
    { label: 'Apple', value: 'apple' },
    { label: 'Banana', value: 'banana' },
];

describe('Select onChange (plain prop)', () => {
    it('fires with the picked value, no model bound', async () => {
        const onChange = vi.fn();
        const { container } = render(<Select options={OPTIONS} onChange={onChange} />);
        await openSelect(container);
        fireEvent.tap(tappable(container, 'select-option'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('apple');
    });

    it('fires alongside a bound model, and the model is written first', async () => {
        const fruit = signal('banana');
        const seen: string[] = [];
        const { container } = render(
            <Select
                options={OPTIONS}
                model={() => fruit.value}
                onChange={() => { seen.push(fruit.value); }}
            />,
        );
        await openSelect(container);
        fireEvent.tap(tappable(container, 'select-option'));
        expect(fruit.value).toBe('apple');
        // The callback observed the committed value, not the stale one.
        expect(seen).toEqual(['apple']);
    });

    it('is optional — picking without it still updates the model', async () => {
        const fruit = signal('banana');
        const { container } = render(<Select options={OPTIONS} model={() => fruit.value} />);
        await openSelect(container);
        expect(() => fireEvent.tap(tappable(container, 'select-option'))).not.toThrow();
        expect(fruit.value).toBe('apple');
    });
});

describe('Radio.Item onSelect (plain prop)', () => {
    it('fires with the item value, no model bound', () => {
        const onSelect = vi.fn();
        const { container } = render(<Radio.Item value="pro" label="Pro" onSelect={onSelect} />);
        fireEvent.tap(tappable(container));
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('pro');
    });

    it('fires alongside a bound model, and the model is written first', () => {
        const plan = signal('free');
        const seen: string[] = [];
        const { container } = render(
            <Radio.Item value="pro" label="Pro" model={() => plan.value} onSelect={() => { seen.push(plan.value); }} />,
        );
        fireEvent.tap(tappable(container));
        expect(plan.value).toBe('pro');
        expect(seen).toEqual(['pro']);
    });

    it('does not fire when disabled', () => {
        const onSelect = vi.fn();
        const { container } = render(<Radio.Item value="pro" label="Pro" disabled onSelect={onSelect} />);
        fireEvent.tap(tappable(container));
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('drives a group of items sharing one callback', () => {
        const picked: string[] = [];
        const { container } = render(
            <Radio>
                <Radio.Item value="free" label="Free" onSelect={(v) => picked.push(v)} />
                <Radio.Item value="pro" label="Pro" onSelect={(v) => picked.push(v)} />
            </Radio>,
        );
        const items = allTappable(container);
        expect(items).toHaveLength(2);
        fireEvent.tap(items[1]);
        fireEvent.tap(items[0]);
        expect(picked).toEqual(['pro', 'free']);
    });
});
