/**
 * Combobox fix wave 10 (#1309, #1314).
 *
 * #1309 — the chevron trigger stayed pointing down when a tap on it opened
 * the list: the tier-2 main-thread press restores the part's scale with an
 * INLINE `transform`, which outranks the skin's `rotate(180deg)` open rule.
 * The unit renderer never runs the worklet transform, so this file stands
 * the press behavior in (as `toggle-press-tier2.test.tsx` does) and asserts
 * the trigger asks for tier 1 only.
 *
 * #1314 — a field under the raised soft keyboard kept its list below it,
 * under the keyboard too: neither side "fits" the trimmed frame, so the
 * popup is placed with `shift` (the roomier side, clamped into the frame).
 * And the keyboard is followed from the field's focus, not only from open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';

const calls = vi.hoisted(() => [] as Array<{ feel: unknown; handlers: Record<string, () => void> }>);
const keyboard = vi.hoisted(() => ({ acquired: 0, released: 0 }));

vi.mock('../src/behaviors/press.js', () => ({
    PRESSED_SCALE: 0.97,
    PRESSED_OPACITY: 0.85,
    createPressFeedback: (options: { feel?: unknown } = {}) => {
        const handlers = {
            'main-thread-bindtouchstart': () => {},
            'main-thread-bindtouchend': () => {},
            'main-thread-bindtouchcancel': () => {},
        };
        calls.push({ feel: options.feel, handlers });
        return { pressed: () => false, handlers, mainThread: options.feel !== false };
    },
}));

vi.mock('../src/behaviors/keyboard.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/behaviors/keyboard.js')>();
    return {
        ...real,
        acquireKeyboard: () => {
            keyboard.acquired++;
            const release = real.acquireKeyboard();
            let done = false;
            return () => {
                if (!done) keyboard.released++;
                done = true;
                release();
            };
        },
    };
});

const { Combobox, OverlayHost, clearDismissLayers } = await import('../src/index');
const { anchorBelowFrame, computeFramedPosition, keyboardFrame } = await import('../src/behaviors/position');

afterEach(() => clearDismissLayers());

const handlersOf = (node: TestNode): Map<string, unknown> =>
    (node as unknown as { _handlers: Map<string, unknown> })._handlers;

const byPart = (root: TestNode, part: string): TestNode => {
    let hit: TestNode | null = null;
    const walk = (n: TestNode): void => {
        if (!hit && n.props['data-scope'] === 'combobox' && n.props['data-part'] === part) hit = n;
        for (const child of n.children) walk(child);
    };
    walk(root);
    if (!hit) throw new Error(`no combobox.${part}`);
    return hit;
};

const fire = async (node: TestNode, key: string, event: unknown = {}): Promise<void> => {
    const h = handlersOf(node).get(key);
    if (!h) throw new Error(`no ${key} on ${node.type}`);
    await act(() => (h as (e: unknown) => void)(event));
    await act(() => {});
};

const ITEMS = [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }];

const renderBox = () => render(
    <OverlayHost>
        <Combobox.Root items={ITEMS} itemValue={(f) => f.value} placeholder="Search" />
    </OverlayHost>,
);

describe('Combobox chevron (#1309)', () => {
    it('the trigger takes tier-1 press only, so no inline transform masks its open rotation', async () => {
        calls.length = 0;
        const { container } = renderBox();
        const trigger = byPart(container, 'trigger');
        const own = calls.find((c) => c.handlers['main-thread-bindtouchstart'] === trigger.props['main-thread-bindtouchstart']
            || c.handlers['main-thread-bindtouchstart'] === handlersOf(trigger).get('main-thread-bindtouchstart'));
        expect(own, 'the trigger spreads its own press instance').toBeDefined();
        expect(own!.feel).toBe(false);
        // And the open state still reaches the part live.
        await fire(trigger, 'catchtap');
        expect(byPart(container, 'trigger').props['data-state']).toBe('open');
        await fire(byPart(container, 'trigger'), 'catchtap');
        expect(byPart(container, 'trigger').props['data-state']).toBe('closed');
    });
});

describe('Combobox under the soft keyboard (#1314)', () => {
    it('follows the keyboard from focus until blur, and lets go on unmount', async () => {
        keyboard.acquired = 0;
        keyboard.released = 0;
        const { container, unmount } = renderBox();
        const input = byPart(container, 'input');
        await fire(input, 'bindfocus');
        expect(keyboard.acquired).toBe(1);
        await fire(input, 'bindfocus');
        expect(keyboard.acquired, 'one hold per focus').toBe(1);
        await fire(input, 'bindblur');
        expect(keyboard.released).toBe(1);
        await fire(input, 'bindfocus');
        expect(keyboard.acquired).toBe(2);
        unmount();
        expect(keyboard.released).toBe(2);
    });

    it('anchorBelowFrame: only a field whose bottom is past the frame', () => {
        const frame = { top: 24, left: 0, right: 411, bottom: 586, width: 411, height: 562 };
        expect(anchorBelowFrame({ top: 625, left: 16, right: 395, bottom: 673, width: 379, height: 48 }, frame)).toBe(true);
        expect(anchorBelowFrame({ top: 400, left: 16, right: 395, bottom: 448, width: 379, height: 48 }, frame)).toBe(false);
        // Within rounding of the edge is not covered.
        expect(anchorBelowFrame({ top: 538, left: 16, right: 395, bottom: 586.5, width: 379, height: 48.5 }, frame)).toBe(false);
        expect(anchorBelowFrame({ top: 625, left: 16, right: 395, bottom: 673, width: 379, height: 48 }, null)).toBe(false);
    });

    it('a field under the keyboard gets its list lifted onto the visible frame, not left below', () => {
        // The Android report: a 411×923 window, the field at y 625, a
        // keyboard covering the bottom 337.
        const outlet = { top: 0, left: 0, right: 411, bottom: 923, width: 411, height: 923 };
        const frame = { top: 24, left: 0, right: 411, bottom: 899, width: 411, height: 875 };
        const trimmed = keyboardFrame(outlet, frame, 337)!;
        expect(trimmed.bottom).toBe(586);
        const anchor = { top: 625, left: 16, right: 395, bottom: 673, width: 379, height: 48 };
        const list = { width: 379, height: 200 };
        const screen = { width: 411, height: 923 };
        // Without the lift, neither side fits and it stays under the keyboard.
        const stuck = computeFramedPosition(anchor, list, outlet, trimmed, screen, { placement: 'bottom-start' });
        expect(stuck.placement).toBe('bottom-start');
        expect(anchorBelowFrame(anchor, trimmed)).toBe(true);
        const lifted = computeFramedPosition(anchor, list, outlet, trimmed, screen, { placement: 'bottom-start', shift: true });
        expect(lifted.placement).toBe('top-start');
        // Wholly inside the visible frame, clear of the keyboard.
        expect(lifted.top).toBeGreaterThanOrEqual(trimmed.top);
        expect(lifted.top + list.height).toBeLessThanOrEqual(trimmed.bottom);
    });
});
