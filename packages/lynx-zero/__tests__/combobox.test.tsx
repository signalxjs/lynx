/**
 * Wave 5 W5B (#1278, epic #1140): Combobox on zero's combobox anatomy — the
 * native `<input>` over Select's portalled listbox. Every state the tests
 * drive is held to BOTH oracles (anatomy + class grammar); the interaction
 * contract (type → open + filter, pick, toggle, resync on close, Enter,
 * clear, tags) is pinned on the rendered TestNode tree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { component, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { Combobox, Field, OverlayHost, clearDismissLayers } from '../src/index';
import { dismissTopLayer } from '../src/behaviors/dismiss';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';
import { pointInRect, tapPoint } from '../src/components/combobox/Combobox';
import { computeFramedPosition, keyboardFrame } from '../src/behaviors/position';

afterEach(() => clearDismissLayers());

const anatomy = anatomies.combobox;

const conforms = (container: unknown): void => {
    expectAnatomy(container as never, anatomy, { portaled: ['popup'] });
    expectClassGrammar(container as never, anatomy);
};

const allParts = (root: TestNode, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === 'combobox' && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};
const byPart = (root: TestNode, part: string): TestNode => {
    const found = allParts(root, part)[0];
    if (!found) throw new Error(`no combobox.${part}`);
    return found;
};
const has = (root: TestNode, part: string): boolean => allParts(root, part).length > 0;
const cls = (node: TestNode): string => String(node._class ?? node.props['class'] ?? '');
const textOf = (node: TestNode): string => node.textContent();
const fire = async (node: TestNode, key: string, event: unknown = {}): Promise<void> => {
    const h = node._handlers.get(key);
    if (!h) throw new Error(`no ${key} on ${node.type} (${String(node.props['data-part'])})`);
    await act(() => (h as (e: unknown) => void)(event));
    await act(() => {});
};
const typeInto = (root: TestNode, text: string): Promise<void> => fire(byPart(root, 'input'), 'bindinput', { detail: { value: text } });
const itemLabels = (root: TestNode): string[] => allParts(root, 'item').map((n) => textOf(n).replace('✓', ''));
const itemNamed = (root: TestNode, label: string): TestNode => {
    const hit = allParts(root, 'item').find((n) => textOf(n).replace('✓', '') === label);
    if (!hit) throw new Error(`no item ${label}`);
    return hit;
};
/** Give the native field a spy `invoke` — focus/blur go through the UI method. */
const spyInvoke = (root: TestNode): ReturnType<typeof vi.fn> => {
    const invoke = vi.fn(() => Promise.resolve());
    (byPart(root, 'input') as unknown as { invoke: unknown }).invoke = invoke;
    return invoke;
};

interface Fruit {
    value: string;
    label: string;
    group?: string;
    disabled?: boolean;
}

const FRUIT: Fruit[] = [
    { value: 'apple', label: 'Apple', group: 'Fruit' },
    { value: 'banana', label: 'Banana', group: 'Fruit' },
    { value: 'carrot', label: 'Carrot', group: 'Veg' },
    { value: 'grape', label: 'Grape', group: 'Fruit', disabled: true },
];

const renderBox = (props: Record<string, unknown> = {}) => render(
    <OverlayHost>
        <Combobox.Root
            items={FRUIT}
            itemValue={(f) => f.value}
            itemDisabled={(f) => !!f.disabled}
            placeholder="Search"
            label="Fruit"
            {...props}
        />
    </OverlayHost>,
);

describe('Combobox — anatomy', () => {
    it('renders root / control / input / trigger on the native <input>, closed, and conforms', () => {
        const { container } = renderBox();
        expect(byPart(container, 'input').type).toBe('input');
        expect(byPart(container, 'control').type).toBe('view');
        expect(byPart(container, 'control').props['data-state']).toBe('closed');
        expect(byPart(container, 'trigger').props['data-state']).toBe('closed');
        expect(byPart(container, 'input').props['placeholder']).toBe('Search');
        expect(byPart(container, 'input').props['accessibility-label']).toBe('Fruit');
        // The control is a row, whatever the skin's `flex` rewrite keeps.
        expect(byPart(container, 'control')._style.flexDirection).toBe('row');
        expect(has(container, 'popup')).toBe(false);
        expect(has(container, 'clear-trigger')).toBe(false);
        conforms(container);
    });

    it('stamps placeholder on root and control while there is no text and nothing chosen', async () => {
        const { container } = renderBox();
        expect(cls(byPart(container, 'root'))).toContain('zx-f-placeholder');
        expect(cls(byPart(container, 'control'))).toContain('zx-f-placeholder');
        await typeInto(container, 'a');
        expect(cls(byPart(container, 'root'))).not.toContain('zx-f-placeholder');
        expect(cls(byPart(container, 'control'))).not.toContain('zx-f-placeholder');
        conforms(container);
    });

    it('stamps every root flag and conforms', () => {
        const { container } = renderBox({ disabled: true, invalid: true, required: true, readonly: true });
        const root = cls(byPart(container, 'root'));
        for (const flag of ['disabled', 'invalid', 'required', 'readonly']) expect(root).toContain(`zx-f-${flag}`);
        const input = byPart(container, 'input');
        expect(input.props['disabled']).toBe(true);
        expect(input.props['readonly']).toBe(true);
        expect(cls(byPart(container, 'trigger'))).toContain('zx-f-disabled');
        conforms(container);
    });

    it('open: popup, groups, separators, items and the tick all conform, and stamp the colour across the portal', async () => {
        // The preset value's label is the field's text and the list filters
        // on it: `filter: false` keeps every option listed.
        const { container } = renderBox({ defaultOpen: true, defaultValue: 'banana', filter: false, itemGroup: (f: Fruit) => f.group, groupSeparators: true, color: 'secondary' });
        await act(() => {});
        const popup = byPart(container, 'popup');
        expect(popup.props['data-state']).toBe('open');
        expect(popup._style.display).toBe('flex');
        expect(popup._style.flexDirection).toBe('column');
        expect(popup._style.position).toBe('absolute');
        expect(allParts(container, 'group')).toHaveLength(2);
        expect(allParts(container, 'separator')).toHaveLength(1);
        expect(allParts(container, 'item-indicator')).toHaveLength(1);
        for (const part of ['popup', 'item', 'separator', 'group-label']) {
            expect(cls(byPart(container, part)), part).toContain('zx-a-color-secondary');
        }
        expect(cls(itemNamed(container, 'Banana'))).toContain('zx-f-selected');
        expect(cls(itemNamed(container, 'Grape'))).toContain('zx-f-disabled');
        expect(byPart(container, 'control').props['data-state']).toBe('open');
        expect(byPart(container, 'input').props['data-state']).toBe('open');
        conforms(container);
    });

    it('a forced pressed / highlighted state lands on every item; a forced ring on a tag', async () => {
        const { container } = render(
            <OverlayHost>
                <ForceStates flags={{ pressed: true, highlighted: true }} parts={['item']}>
                    <Combobox.Root items={FRUIT} itemValue={(f) => f.value} defaultOpen />
                </ForceStates>
                <ForceStates flags={{ 'focus-visible': true }} parts={['tag']}>
                    <Combobox.Root items={FRUIT} itemValue={(f) => f.value} multiple defaultValue={['apple']} />
                </ForceStates>
            </OverlayHost>,
        );
        await act(() => {});
        for (const item of allParts(container, 'item')) {
            expect(cls(item)).toContain('zx-f-pressed');
            expect(cls(item)).toContain('zx-f-highlighted');
        }
        expect(cls(byPart(container, 'tag'))).toContain('zx-f-focus-visible');
        conforms(container);
    });
});

describe('Combobox — typing, filtering, picking', () => {
    it('typing writes model:inputValue, opens the list and filters it (contains, case-insensitive)', async () => {
        const st = signal({ q: '', open: false });
        const onInput = vi.fn();
        const { container } = render(
            <OverlayHost>
                <Combobox.Root
                    items={FRUIT}
                    itemValue={(f) => f.value}
                    model:inputValue={() => st.q}
                    model:open={() => st.open}
                    onInputValueChange={onInput}
                />
            </OverlayHost>,
        );
        await typeInto(container, 'AN');
        expect(st.q).toBe('AN');
        expect(onInput).toHaveBeenCalledWith('AN');
        expect(st.open).toBe(true);
        expect(itemLabels(container)).toEqual(['Banana']);
        await typeInto(container, 'ap');
        expect(itemLabels(container)).toEqual(['Apple', 'Grape']);
        conforms(container);
    });

    it('filter={false} shows every item; a custom filter replaces the rule', async () => {
        const a = renderBox({ filter: false });
        await typeInto(a.container, 'zzz');
        expect(itemLabels(a.container)).toHaveLength(4);
        const b = renderBox({ filter: (f: Fruit, q: string) => f.label.startsWith(q) });
        await typeInto(b.container, 'a');
        expect(itemLabels(b.container)).toEqual([]);
        await typeInto(b.container, 'C');
        expect(itemLabels(b.container)).toEqual(['Carrot']);
    });

    it('a pick fills the text with the label, closes, and puts the keyboard away', async () => {
        const st = signal({ v: null as string | null });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} />
            </OverlayHost>,
        );
        const invoke = spyInvoke(container);
        await typeInto(container, 'ban');
        await fire(itemNamed(container, 'Banana'), 'bindtap');
        expect(st.v).toBe('banana');
        expect(byPart(container, 'input').props['value']).toBe('Banana');
        expect(has(container, 'popup')).toBe(false);
        expect(byPart(container, 'control').props['data-state']).toBe('closed');
        expect(invoke).toHaveBeenCalledWith('blur', {});
    });

    it('an input event echoing the model\'s own text is not typing (Android, #1298)', async () => {
        // Android fires `input` for programmatic writes: the preset label at
        // mount, the picked label after a pick. Neither may open the list.
        const st = signal({ v: 'apple' as string | null });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} />
            </OverlayHost>,
        );
        await act(() => {});
        await typeInto(container, 'Apple');
        expect(has(container, 'popup')).toBe(false);
        expect(byPart(container, 'control').props['data-state']).toBe('closed');

        // Typing still opens; the pick's echo leaves it closed.
        await typeInto(container, 'ca');
        expect(has(container, 'popup')).toBe(true);
        await fire(itemNamed(container, 'Carrot'), 'bindtap');
        expect(st.v).toBe('carrot');
        await typeInto(container, 'Carrot');
        expect(has(container, 'popup')).toBe(false);
        expect(byPart(container, 'input').props['value']).toBe('Carrot');
    });

    it('a disabled option takes no pick', async () => {
        const st = signal({ v: null as string | null });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} itemDisabled={(f) => !!f.disabled} model={() => st.v} defaultOpen />
            </OverlayHost>,
        );
        await act(() => {});
        await fire(itemNamed(container, 'Grape'), 'bindtap');
        expect(st.v).toBeNull();
        expect(has(container, 'popup')).toBe(true);
    });

    it('a preset value shows its label; a value written from outside moves the text', async () => {
        const st = signal({ v: 'carrot' as string | null });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} />
            </OverlayHost>,
        );
        expect(byPart(container, 'input').props['value']).toBe('Carrot');
        await act(() => { st.v = 'apple'; });
        await act(() => {});
        expect(byPart(container, 'input').props['value']).toBe('Apple');
        await act(() => { st.v = null; });
        await act(() => {});
        expect(byPart(container, 'input').props['value']).toBe('');
    });

    it('the trigger toggles the list without focusing the field', async () => {
        const { container } = renderBox();
        const invoke = spyInvoke(container);
        await fire(byPart(container, 'trigger'), 'catchtap');
        expect(has(container, 'popup')).toBe(true);
        expect(itemLabels(container)).toHaveLength(4);
        expect(byPart(container, 'trigger').props['data-state']).toBe('open');
        expect(invoke).not.toHaveBeenCalledWith('focus', {});
        await fire(byPart(container, 'trigger'), 'catchtap');
        expect(has(container, 'popup')).toBe(false);
    });

    it('openOnClick opens on focus; focus-visible follows native focus on control and input', async () => {
        const { container } = renderBox({ openOnClick: true });
        await fire(byPart(container, 'input'), 'bindfocus');
        expect(has(container, 'popup')).toBe(true);
        expect(cls(byPart(container, 'control'))).toContain('zx-f-focus-visible');
        expect(cls(byPart(container, 'input'))).toContain('zx-f-focus-visible');
        await fire(byPart(container, 'input'), 'bindblur');
        expect(cls(byPart(container, 'control'))).not.toContain('zx-f-focus-visible');
        conforms(container);
    });

    it('a tap on the control focuses the field', async () => {
        const { container } = renderBox();
        const invoke = spyInvoke(container);
        await fire(byPart(container, 'control'), 'bindtap');
        expect(invoke).toHaveBeenCalledWith('focus', {});
    });
});

describe('Combobox — resync on close (zero #265)', () => {
    it('typed text reverts to the chosen label on light dismiss', async () => {
        const st = signal({ v: 'apple' as string | null });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} />
            </OverlayHost>,
        );
        await typeInto(container, 'car');
        expect(has(container, 'popup')).toBe(true);
        // What the surface's tap does away from the field.
        await act(() => { dismissTopLayer(); });
        await act(() => {});
        expect(has(container, 'popup')).toBe(false);
        expect(st.v).toBe('apple');
        expect(byPart(container, 'input').props['value']).toBe('Apple');
    });

    it('emptied text clears the value on close', async () => {
        const st = signal({ v: 'apple' as string | null, open: false });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} model:open={() => st.open} />
            </OverlayHost>,
        );
        await typeInto(container, '');
        await act(() => { st.open = false; });
        await act(() => {});
        expect(st.v).toBeNull();
    });

    it('a blur while closed resyncs too; a blur while open waits for the close', async () => {
        const st = signal({ v: 'apple' as string | null, open: false });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} model:open={() => st.open} />
            </OverlayHost>,
        );
        await typeInto(container, 'xyz');
        await fire(byPart(container, 'input'), 'bindblur');
        // Still open: a tap on an option may be on its way.
        expect(byPart(container, 'input').props['value']).toBe('xyz');
        await act(() => { st.open = false; });
        await act(() => {});
        expect(byPart(container, 'input').props['value']).toBe('Apple');
    });

    it('allowCustom commits the text on close and on Enter', async () => {
        const st = signal({ v: null as string | null, open: false });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} model:open={() => st.open} allowCustom />
            </OverlayHost>,
        );
        await typeInto(container, 'Kiwi');
        await fire(byPart(container, 'input'), 'bindconfirm');
        expect(st.v).toBe('Kiwi');
        expect(st.open).toBe(false);
        // Text that names an option commits the option.
        await typeInto(container, 'carrot');
        await act(() => { st.open = false; });
        await act(() => {});
        expect(st.v).toBe('carrot');
        expect(byPart(container, 'input').props['value']).toBe('Carrot');
    });
});

describe('Combobox — the selected value\'s lifecycle (#1319, the web\'s contract)', () => {
    const lifecycle = (props: Record<string, unknown> = {}) => {
        const st = signal({ v: 'banana' as string | null, q: '', open: false });
        const r = render(
            <OverlayHost>
                <Combobox.Root
                    items={FRUIT}
                    itemValue={(f) => f.value}
                    model={() => st.v}
                    model:open={() => st.open}
                    placeholder="Search fruit"
                    {...props}
                />
            </OverlayHost>,
        );
        return { st, container: r.container };
    };
    const text = (root: TestNode): unknown => byPart(root, 'input').props['value'];
    const dismiss = async (): Promise<void> => {
        await act(() => { dismissTopLayer(); });
        await act(() => {});
    };

    it('a preset value\'s label is the field\'s text, even over an empty defaultInputValue', async () => {
        for (const extra of [{}, { defaultInputValue: '' }]) {
            const { st, container } = lifecycle(extra);
            await act(() => {});
            expect(text(container)).toBe('Banana');
            expect(st.v).toBe('banana');
            expect(cls(byPart(container, 'root'))).not.toContain('zx-f-placeholder');
        }
        // A non-empty preset text is a live query and stays.
        const { container } = lifecycle({ defaultInputValue: 'ap' });
        expect(text(container)).toBe('ap');
    });

    it('the preset survives an open from the chevron and a light dismiss without typing', async () => {
        const { st, container } = lifecycle({ filter: false });
        await fire(byPart(container, 'trigger'), 'catchtap');
        expect(cls(itemNamed(container, 'Banana'))).toContain('zx-f-selected');
        await dismiss();
        expect(has(container, 'popup')).toBe(false);
        expect(st.v).toBe('banana');
        expect(text(container)).toBe('Banana');
        // Reopened, Banana is still the checked row.
        await fire(byPart(container, 'trigger'), 'catchtap');
        expect(cls(itemNamed(container, 'Banana'))).toContain('zx-f-selected');
        expect(allParts(container, 'item-indicator')).toHaveLength(1);
    });

    it('the gallery\'s open-at-mount preset keeps its value through a dismiss', async () => {
        const { st, container } = lifecycle({ defaultOpen: true, defaultInputValue: '', filter: false });
        await act(() => {});
        expect(text(container)).toBe('Banana');
        await dismiss();
        expect(st.v).toBe('banana');
        expect(text(container)).toBe('Banana');
    });

    it('a pick replaces the value and shows its label; a dismiss after it keeps it', async () => {
        const { st, container } = lifecycle({ filter: false });
        await fire(byPart(container, 'trigger'), 'catchtap');
        await fire(itemNamed(container, 'Carrot'), 'bindtap');
        expect(st.v).toBe('carrot');
        expect(text(container)).toBe('Carrot');
        await fire(byPart(container, 'trigger'), 'catchtap');
        await dismiss();
        expect(st.v).toBe('carrot');
        expect(text(container)).toBe('Carrot');
    });

    it('type then dismiss: the text reverts to the label and the value stays', async () => {
        const { st, container } = lifecycle();
        await typeInto(container, 'car');
        expect(has(container, 'popup')).toBe(true);
        await dismiss();
        expect(st.v).toBe('banana');
        expect(text(container)).toBe('Banana');
        // A blur while closed resyncs the same way.
        await typeInto(container, 'zz');
        await act(() => { st.open = false; });
        await act(() => {});
        await fire(byPart(container, 'input'), 'bindblur');
        expect(st.v).toBe('banana');
        expect(text(container)).toBe('Banana');
    });

    it('text the user emptied clears the value on dismiss (web: "emptied text clears the value on blur")', async () => {
        const { st, container } = lifecycle();
        await typeInto(container, '');
        expect(has(container, 'popup')).toBe(true);
        await dismiss();
        expect(st.v).toBeNull();
        expect(text(container)).toBe('');
    });

    it('the clear-trigger clears the value and the text; a dismiss after it keeps it cleared', async () => {
        const { st, container } = lifecycle({ clearable: true });
        spyInvoke(container);
        await fire(byPart(container, 'clear-trigger'), 'catchtap');
        expect(st.v).toBeNull();
        expect(text(container)).toBe('');
        await fire(byPart(container, 'trigger'), 'catchtap');
        expect(allParts(container, 'item-indicator')).toHaveLength(0);
        await dismiss();
        expect(st.v).toBeNull();
        expect(text(container)).toBe('');
    });
});

describe('Combobox — autoHighlight and Enter', () => {
    it('highlights the first enabled match while there is a query; Enter commits it', async () => {
        const st = signal({ v: null as string | null });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} itemDisabled={(f) => !!f.disabled} model={() => st.v} autoHighlight />
            </OverlayHost>,
        );
        await typeInto(container, 'ap');
        expect(cls(itemNamed(container, 'Apple'))).toContain('zx-f-highlighted');
        expect(cls(itemNamed(container, 'Grape'))).not.toContain('zx-f-highlighted');
        conforms(container);
        await typeInto(container, 'gr');
        // Grape is disabled: nothing enabled matches.
        expect(allParts(container, 'item').some((n) => cls(n).includes('zx-f-highlighted'))).toBe(false);
        await typeInto(container, 'ban');
        await fire(byPart(container, 'input'), 'bindconfirm');
        expect(st.v).toBe('banana');
        expect(has(container, 'popup')).toBe(false);
    });

    it('without autoHighlight, Enter does nothing (no arrows to highlight with)', async () => {
        const st = signal({ v: null as string | null });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} />
            </OverlayHost>,
        );
        await typeInto(container, 'ban');
        expect(allParts(container, 'item').some((n) => cls(n).includes('zx-f-highlighted'))).toBe(false);
        await fire(byPart(container, 'input'), 'bindconfirm');
        expect(st.v).toBeNull();
    });
});

describe('Combobox — empty, loading, clear', () => {
    it('emptyText renders while nothing matches; loading holds it back and marks the list busy', async () => {
        const st = signal({ loading: false });
        const Box = component(() => () => (
            <Combobox.Root items={FRUIT} itemValue={(f) => f.value} emptyText="No match" loading={st.loading} loadingText="Loading…" />
        ));
        const { container } = render(<OverlayHost><Box /></OverlayHost>);
        await typeInto(container, 'zzz');
        expect(textOf(byPart(container, 'empty'))).toBe('No match');
        expect(has(container, 'loading')).toBe(false);
        conforms(container);
        await act(() => { st.loading = true; });
        await act(() => {});
        expect(has(container, 'empty')).toBe(false);
        expect(textOf(byPart(container, 'loading'))).toBe('Loading…');
        expect(byPart(container, 'popup').props['accessibility-status']).toBe('busy');
        conforms(container);
    });

    it('an open list with nothing to show paints no panel', async () => {
        const { container } = renderBox();
        await typeInto(container, 'zzz');
        expect(byPart(container, 'control').props['data-state']).toBe('open');
        expect(has(container, 'popup')).toBe(false);
        await typeInto(container, 'a');
        expect(has(container, 'popup')).toBe(true);
    });

    it('the clear-trigger renders while there is a value or text, clears both and focuses the field', async () => {
        const st = signal({ v: 'apple' as string | null });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} model={() => st.v} clearable />
            </OverlayHost>,
        );
        const invoke = spyInvoke(container);
        expect(byPart(container, 'clear-trigger').props['accessibility-label']).toBe('Clear');
        conforms(container);
        await fire(byPart(container, 'clear-trigger'), 'catchtap');
        expect(st.v).toBeNull();
        expect(byPart(container, 'input').props['value']).toBe('');
        expect(invoke).toHaveBeenCalledWith('focus', {});
        expect(has(container, 'clear-trigger')).toBe(false);
        await typeInto(container, 'x');
        expect(has(container, 'clear-trigger')).toBe(true);
    });

    it('disabled and readonly: no clear-trigger, no typing, no opening', async () => {
        for (const extra of [{ disabled: true }, { readonly: true }]) {
            const { container } = renderBox({ defaultValue: 'apple', clearable: true, ...extra });
            expect(has(container, 'clear-trigger'), JSON.stringify(extra)).toBe(false);
            await fire(byPart(container, 'trigger'), 'catchtap');
            expect(has(container, 'popup'), JSON.stringify(extra)).toBe(false);
            await typeInto(container, 'b');
            expect(byPart(container, 'control').props['data-state']).toBe('closed');
            conforms(container);
        }
    });
});

describe('Combobox — multiple (tags)', () => {
    it('a pick toggles, clears the query and keeps the list open; tags render before the field', async () => {
        const st = signal({ v: ['apple'] as string[] });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} multiple model={() => st.v} />
            </OverlayHost>,
        );
        expect(allParts(container, 'tag').map(textOf)).toEqual(['Apple×']);
        // Tag before the input inside the control.
        const control = byPart(container, 'control');
        const order = control.children.map((c) => String(c.props['data-part']));
        expect(order.indexOf('tag')).toBeLessThan(order.indexOf('input'));
        await typeInto(container, 'car');
        await fire(itemNamed(container, 'Carrot'), 'bindtap');
        expect(st.v).toEqual(['apple', 'carrot']);
        expect(byPart(container, 'input').props['value']).toBe('');
        expect(has(container, 'popup')).toBe(true);
        // Toggle off.
        await fire(itemNamed(container, 'Apple'), 'bindtap');
        expect(st.v).toEqual(['carrot']);
        conforms(container);
    });

    it('a tag\'s remove drops its value; inert while readonly', async () => {
        const st = signal({ v: ['apple', 'banana'] as string[] });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} multiple model={() => st.v} />
            </OverlayHost>,
        );
        const remove = allParts(container, 'tag-remove')[0]!;
        expect(remove.props['accessibility-label']).toBe('Remove Apple');
        await fire(remove, 'catchtap');
        expect(st.v).toEqual(['banana']);
        const ro = renderBox({ multiple: true, defaultValue: ['apple'], readonly: true });
        await fire(byPart(ro.container, 'tag-remove'), 'catchtap');
        expect(allParts(ro.container, 'tag')).toHaveLength(1);
    });

    it('a close drops the query; allowCustom adds free text as a tag on Enter', async () => {
        const st = signal({ v: [] as string[], open: false });
        const { container } = render(
            <OverlayHost>
                <Combobox.Root items={FRUIT} itemValue={(f) => f.value} multiple allowCustom model={() => st.v} model:open={() => st.open} />
            </OverlayHost>,
        );
        await typeInto(container, 'Kiwi');
        await fire(byPart(container, 'input'), 'bindconfirm');
        expect(st.v).toEqual(['Kiwi']);
        expect(allParts(container, 'tag').map(textOf)).toEqual(['Kiwi×']);
        await typeInto(container, 'zz');
        await act(() => { st.open = false; });
        await act(() => {});
        expect(byPart(container, 'input').props['value']).toBe('');
    });

    it('the tag slot replaces the label + remove', () => {
        const { container } = render(
            <OverlayHost>
                <Combobox.Root
                    items={FRUIT}
                    itemValue={(f) => f.value}
                    multiple
                    defaultValue={['apple']}
                    slots={{ tag: (p: { label: string }) => <text>{`#${p.label}`}</text> }}
                />
            </OverlayHost>,
        );
        expect(textOf(byPart(container, 'tag'))).toBe('#Apple');
        expect(has(container, 'tag-remove')).toBe(false);
    });
});

describe('Combobox — Field integration', () => {
    it('adopts the field\'s flags and size', () => {
        const { container } = render(
            <OverlayHost>
                <Field.Root invalid disabled size="lg">
                    <Field.Label>Fruit</Field.Label>
                    <Combobox.Root items={FRUIT} itemValue={(f) => f.value} />
                </Field.Root>
            </OverlayHost>,
        );
        const root = cls(byPart(container, 'root'));
        expect(root).toContain('zx-f-invalid');
        expect(root).toContain('zx-f-disabled');
        expect(cls(byPart(container, 'control'))).toContain('zx-a-size-lg');
        conforms(container);
    });
});

describe('Combobox — geometry helpers', () => {
    it('tapPoint reads client, then page, then detail coordinates', () => {
        expect(tapPoint({ changedTouches: [{ clientX: 3, clientY: 4 }] })).toEqual({ x: 3, y: 4 });
        expect(tapPoint({ touches: [{ pageX: 5, pageY: 6 }] })).toEqual({ x: 5, y: 6 });
        expect(tapPoint({ detail: { x: 7, y: 8 } })).toEqual({ x: 7, y: 8 });
        expect(tapPoint({})).toBeNull();
        expect(tapPoint(undefined)).toBeNull();
    });

    it('pointInRect allows a pixel of rounding', () => {
        const r = { top: 100, left: 10, width: 200, height: 48 };
        expect(pointInRect({ x: 10, y: 100 }, r)).toBe(true);
        expect(pointInRect({ x: 210.5, y: 148.5 }, r)).toBe(true);
        expect(pointInRect({ x: 50, y: 160 }, r)).toBe(false);
    });

    it('keyboardFrame cuts the keyboard off the frame; the list then flips above its field', () => {
        const outlet = { top: 0, left: 0, right: 400, bottom: 800, width: 400, height: 800 };
        const frame = { top: 60, left: 0, right: 400, bottom: 770, width: 400, height: 710 };
        expect(keyboardFrame(outlet, frame, 0)).toBe(frame);
        expect(keyboardFrame(null, frame, 300)).toBe(frame);
        const trimmed = keyboardFrame(outlet, frame, 300)!;
        expect(trimmed.top).toBe(60);
        expect(trimmed.height).toBe(440);
        expect(trimmed.bottom).toBe(500);
        // A keyboard covering everything is ignored rather than leaving no room.
        expect(keyboardFrame(outlet, frame, 790)).toBe(frame);
        // No frame: the outlet is the base.
        expect(keyboardFrame(outlet, null, 300)!.height).toBe(500);

        // A field at y 400–448 with a 200pt list: below fits without the
        // keyboard, and flips above once the keyboard covers the bottom 300.
        const anchor = { top: 400, left: 16, right: 316, bottom: 448, width: 300, height: 48 };
        const list = { width: 300, height: 200 };
        const screen = { width: 400, height: 800 };
        const open = computeFramedPosition(anchor, list, outlet, frame, screen, { placement: 'bottom-start' });
        expect(open.placement).toBe('bottom-start');
        const lifted = computeFramedPosition(anchor, list, outlet, trimmed, screen, { placement: 'bottom-start' });
        expect(lifted.placement).toBe('top-start');
        expect(lifted.top + list.height).toBeLessThanOrEqual(anchor.top);
    });
});
