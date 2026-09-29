/**
 * Combobox fix wave 12 (#1326): the clear-trigger did nothing while the list
 * was open. The open list's light-dismiss surface covers the window, the
 * field included, so a tap on the × landed on the surface — which only
 * focused the field. The surface now hit-tests the clear-trigger and the
 * chevron itself.
 *
 * `useViewportRect` is the one seam faked here: the real one measures on the
 * main thread, which the test renderer does not run. Each fake is matched to
 * its element by the `main-thread:ref` the element carries, and the test
 * sets the rects by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';

interface FakeRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

const fakes = vi.hoisted(() => ({
    rects: [] as { ref: unknown; rect: { value: unknown }; measure: () => void; measured: number }[],
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

const { Combobox, OverlayHost, clearDismissLayers } = await import('../src/index');
const { surfaceTarget } = await import('../src/components/combobox/Combobox');

afterEach(() => {
    clearDismissLayers();
    fakes.rects.length = 0;
});

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
const handlersOf = (node: TestNode): Map<string, unknown> =>
    (node as unknown as { _handlers: Map<string, unknown> })._handlers;
const fire = async (node: TestNode, key: string, event: unknown = {}): Promise<void> => {
    const h = handlersOf(node).get(key);
    if (!h) throw new Error(`no ${key} on ${node.type}`);
    await act(() => (h as (e: unknown) => void)(event));
    await act(() => {});
};
const itemLabels = (root: TestNode): string[] =>
    allParts(root, 'item').map((n) => n.textContent().replace('✓', ''));

/** The transparent surface: the portal's full-window view with a bindtap. */
const surfaceOf = (root: TestNode): TestNode => {
    let hit: TestNode | null = null;
    const walk = (n: TestNode): void => {
        if (!hit && n.props['native-interaction-enabled'] === false && handlersOf(n).has('bindtap')) hit = n;
        for (const child of n.children) walk(child);
    };
    walk(root);
    if (!hit) throw new Error('no dismiss surface');
    return hit;
};

/** Set the fake rect of whatever element carries this node's `main-thread:ref`. */
const setRectOf = async (node: TestNode, rect: FakeRect): Promise<void> => {
    const ref = node.props['main-thread:ref'];
    const entry = fakes.rects.find((e) => e.ref === ref);
    if (!entry) throw new Error(`no measured rect for ${String(node.props['data-part'])}`);
    await act(() => {
        entry.rect.value = rect;
    });
};

const tapAt = (x: number, y: number) => ({ changedTouches: [{ clientX: x, clientY: y }] });

const FRUIT = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'mango', label: 'Mango' },
];

// The field at (0,100) 300×48: the × at x 230–260, the chevron at 262–292.
const CONTROL = { left: 0, top: 100, width: 300, height: 48 };
const CLEAR = { left: 230, top: 110, width: 30, height: 28 };
const TRIGGER = { left: 262, top: 110, width: 30, height: 28 };

/** The gallery's `open-query`: typed "an", autoHighlight, clearable, list open at mount. */
const openQuery = async (extra: Record<string, unknown> = {}) => {
    const st = signal({ v: null as string | null, q: 'an', open: true });
    const utils = render(
        <OverlayHost>
            <Combobox.Root
                items={FRUIT}
                itemValue={(f) => f.value}
                model={() => st.v}
                model:inputValue={() => st.q}
                model:open={() => st.open}
                autoHighlight
                clearable
                {...extra}
            />
        </OverlayHost>,
    );
    await act(() => {});
    const { container } = utils;
    const invoke = vi.fn(() => Promise.resolve());
    (byPart(container, 'input') as unknown as { invoke: unknown }).invoke = invoke;
    await setRectOf(byPart(container, 'control'), CONTROL);
    if (has(container, 'clear-trigger')) await setRectOf(byPart(container, 'clear-trigger'), CLEAR);
    await setRectOf(byPart(container, 'trigger'), TRIGGER);
    return { ...utils, st, invoke };
};

describe('surfaceTarget (#1326)', () => {
    const rects = { clear: CLEAR, trigger: TRIGGER, anchor: CONTROL };

    it('the clear-trigger and the chevron win over the field they sit in', () => {
        expect(surfaceTarget({ x: 245, y: 124 }, rects)).toBe('clear');
        expect(surfaceTarget({ x: 277, y: 124 }, rects)).toBe('trigger');
        expect(surfaceTarget({ x: 40, y: 124 }, rects)).toBe('field');
        expect(surfaceTarget({ x: 40, y: 400 }, rects)).toBe('outside');
    });

    it('an unmeasured or absent part falls back to the field; no point is outside', () => {
        expect(surfaceTarget({ x: 245, y: 124 }, { ...rects, clear: null })).toBe('field');
        expect(surfaceTarget({ x: 277, y: 124 }, { ...rects, trigger: null })).toBe('field');
        expect(surfaceTarget({ x: 245, y: 124 }, { clear: null, trigger: null, anchor: null })).toBe('outside');
        expect(surfaceTarget(null, rects)).toBe('outside');
    });
});

describe('Combobox — the clear-trigger while the list is open (#1326)', () => {
    it('a tap on the × clears the typed text, keeps the list open on every item and focuses the field', async () => {
        const { container, st, invoke } = await openQuery();
        expect(itemLabels(container)).toEqual(['Banana', 'Mango']);
        await fire(surfaceOf(container), 'bindtap', tapAt(245, 124));
        expect(st.q).toBe('');
        expect(byPart(container, 'input').props['value']).toBe('');
        expect(st.open).toBe(true);
        expect(has(container, 'popup')).toBe(true);
        expect(itemLabels(container)).toEqual(['Apple', 'Banana', 'Mango']);
        // Nothing typed: autoHighlight lets go.
        expect(allParts(container, 'item').some((n) => n.props['data-highlighted'] !== undefined)).toBe(false);
        expect(invoke).toHaveBeenCalledWith('focus', {});
        // Nothing left to clear: the × goes.
        expect(has(container, 'clear-trigger')).toBe(false);
    });

    it('a tap on the × clears a chosen value too, and the list stays open', async () => {
        const { container, st } = await openQuery();
        await act(() => {
            st.v = 'banana';
            st.q = 'Banana';
        });
        await act(() => {});
        await fire(surfaceOf(container), 'bindtap', tapAt(245, 124));
        expect(st.v).toBeNull();
        expect(st.q).toBe('');
        expect(st.open).toBe(true);
    });

    it('the × on the surface works with no measurement of the field yet', async () => {
        const { container, st } = await openQuery();
        await setRectOf(byPart(container, 'control'), null as unknown as FakeRect);
        await fire(surfaceOf(container), 'bindtap', tapAt(245, 124));
        expect(st.q).toBe('');
    });

    it('a tap on the chevron closes the list without focusing the field', async () => {
        const { container, st, invoke } = await openQuery();
        await fire(surfaceOf(container), 'bindtap', tapAt(277, 124));
        expect(st.open).toBe(false);
        expect(has(container, 'popup')).toBe(false);
        expect(invoke).not.toHaveBeenCalledWith('focus', {});
    });

    it('elsewhere on the field still focuses and keeps the text; outside still dismisses', async () => {
        const { container, st, invoke } = await openQuery();
        await fire(surfaceOf(container), 'bindtap', tapAt(40, 124));
        expect(invoke).toHaveBeenCalledWith('focus', {});
        expect(st.q).toBe('an');
        expect(st.open).toBe(true);
        await fire(surfaceOf(container), 'bindtap', tapAt(40, 500));
        expect(st.open).toBe(false);
    });

    it('a stale × rect is ignored once the × is gone: the tap focuses the field', async () => {
        const { container, st, invoke } = await openQuery();
        await fire(surfaceOf(container), 'bindtap', tapAt(245, 124));
        expect(has(container, 'clear-trigger')).toBe(false);
        invoke.mockClear();
        await fire(surfaceOf(container), 'bindtap', tapAt(245, 124));
        expect(invoke).toHaveBeenCalledWith('focus', {});
        expect(st.open).toBe(true);
    });

    it('readonly: no ×, and the surface never clears', async () => {
        const { container, st } = await openQuery({ readonly: true });
        expect(has(container, 'clear-trigger')).toBe(false);
        await fire(surfaceOf(container), 'bindtap', tapAt(245, 124));
        expect(st.q).toBe('an');
    });

    it('opening re-measures the × and the chevron with the field', async () => {
        const { container, st } = await openQuery();
        const clearEntry = fakes.rects.find((e) => e.ref === byPart(container, 'clear-trigger').props['main-thread:ref'])!;
        const triggerEntry = fakes.rects.find((e) => e.ref === byPart(container, 'trigger').props['main-thread:ref'])!;
        await act(() => {
            st.open = false;
        });
        await act(() => {});
        const before = [clearEntry.measured, triggerEntry.measured];
        await act(() => {
            st.open = true;
        });
        await act(() => {});
        expect(clearEntry.measured).toBeGreaterThan(before[0]!);
        expect(triggerEntry.measured).toBeGreaterThan(before[1]!);
    });
});
