/**
 * Toggle / ToggleGroup wire the tier-2 main-thread press (#1204): the unit
 * renderer never runs the worklet transform, so `createPressFeedback` falls
 * back to tier 1 there. This file stands the behavior in with its tier-2
 * shape (the `main-thread-bindtouch*` family) and asserts the components
 * spread it onto the touched part — one instance per item — with the feel
 * on by default and off under `pressFeel={false}`. The worklets themselves
 * are covered by `press-mt.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';

const calls = vi.hoisted(() => [] as Array<{ feel: unknown; handlers: Record<string, () => void> }>);

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
        return { pressed: () => false, handlers, mainThread: true };
    },
}));

const { Toggle, ToggleGroup } = await import('../src/index');

const handlersOf = (node: TestNode): Map<string, unknown> =>
    (node as unknown as { _handlers: Map<string, unknown> })._handlers;

const find = (root: TestNode, scope: string, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === scope && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};

const mtHandlers = (node: TestNode): unknown[] => {
    const h = handlersOf(node);
    const fromProps = (key: string): unknown => node.props[key] ?? h?.get(key);
    return ['main-thread-bindtouchstart', 'main-thread-bindtouchend', 'main-thread-bindtouchcancel'].map(fromProps);
};

describe('tier-2 press wiring', () => {
    it('Toggle.Root spreads the main-thread press family, feel on by default', () => {
        calls.length = 0;
        const { container } = render(<Toggle.Root><text>B</text></Toggle.Root>);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.feel).toBe(true);
        const root = find(container, 'toggle', 'root')[0]!;
        const wired = mtHandlers(root);
        expect(wired.every((fn) => typeof fn === 'function')).toBe(true);
        expect(wired[0]).toBe(calls[0]!.handlers['main-thread-bindtouchstart']);
    });

    it('pressFeel={false} asks for tier 1 only', () => {
        calls.length = 0;
        render(<Toggle.Root pressFeel={false}><text>B</text></Toggle.Root>);
        expect(calls[0]!.feel).toBe(false);
    });

    it('every ToggleGroup item owns its own press instance', () => {
        calls.length = 0;
        const { container } = render(
            <ToggleGroup.Root>
                <ToggleGroup.Item value="a"><text>A</text></ToggleGroup.Item>
                <ToggleGroup.Item value="b" pressFeel={false}><text>B</text></ToggleGroup.Item>
            </ToggleGroup.Root>,
        );
        expect(calls.map((c) => c.feel)).toEqual([true, false]);
        const [a, b] = find(container, 'toggle-group', 'item');
        expect(mtHandlers(a!)[0]).toBe(calls[0]!.handlers['main-thread-bindtouchstart']);
        expect(mtHandlers(b!)[0]).toBe(calls[1]!.handlers['main-thread-bindtouchstart']);
        // The root is a frame, not a pressable.
        expect(mtHandlers(find(container, 'toggle-group', 'root')[0]!)[0]).toBeUndefined();
    });
});
