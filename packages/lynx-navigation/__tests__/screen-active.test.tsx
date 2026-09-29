/**
 * Screen activity and the edge swipe as a back press (fix wave 10).
 *
 * #1308: every screen `<Stack>` renders provides `useScreenActive()` (from
 * `@sigx/lynx`): active while it is the focused top AND no transition is in
 * flight. A covered screen stays mounted, and overlays read this to stop
 * painting over the screen on top.
 *
 * #1312: while a back interceptor is registered, the Stack's edge strip is
 * a back PRESS: interceptors first, pop only when none consumed it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addBackInterceptor, component, useScreenActive } from '@sigx/lynx';
import type { TestNode } from '@sigx/lynx-testing';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { useNav } from '../src/hooks/use-nav';
import { routes } from './_fixtures';

interface NavProbe { nav: ReturnType<typeof useNav> | null }
const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    props.probe.nav = useNav();
    return () => null;
});

const activeOf: Record<string, () => boolean> = {};
const ActiveProbe = (name: string) => component(() => {
    activeOf[name] = useScreenActive();
    return () => <view><text>{name}</text></view>;
});

const walk = (node: TestNode, out: TestNode[] = []): TestNode[] => {
    out.push(node);
    for (const child of node.children) walk(child, out);
    return out;
};

/** The Stack's edge strip that routes through the interceptors. */
const interceptStrip = (root: TestNode): TestNode | null =>
    walk(root).find((n) => n._style?.width === '20px' && n._handlers?.has('bindtouchend')) ?? null;
/** The interactive edge handle (a main-thread gesture, no BG touch handlers). */
const edgeHandle = (root: TestNode): TestNode | null =>
    walk(root).find((n) => n._style?.width === '20px' && !n._handlers?.has('bindtouchend')) ?? null;

const swipe = (node: TestNode, dx: number): void => {
    fireEvent.touchStart(node as never, { touches: [touch(2, 300)] });
    fireEvent.touchMove(node as never, { touches: [touch(2 + dx / 2, 300)] });
    fireEvent.touchEnd(node as never, { changedTouches: [touch(2 + dx, 300)] });
};

const localRoutes = {
    ...routes,
    home: { component: ActiveProbe('home') },
    settings: { component: ActiveProbe('settings') },
} as typeof routes;

describe('useScreenActive from <Stack> (#1308)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('is inactive while covered or in transition, active once the screen is at rest on top', async () => {
        const probe: NavProbe = { nav: null };
        render(
            <NavigationRoot routes={localRoutes} initialRoute="home">
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        expect(activeOf.home!()).toBe(true);

        act(() => { probe.nav!.push('settings'); });
        // The covered screen goes inactive the moment the push starts, and
        // the incoming one waits for the slide to land.
        expect(activeOf.home!()).toBe(false);
        expect(activeOf.settings!()).toBe(false);
        await vi.runAllTimersAsync();
        expect(activeOf.settings!()).toBe(true);
        expect(activeOf.home!()).toBe(false);

        act(() => { probe.nav!.pop(); });
        expect(activeOf.home!()).toBe(false);
        await vi.runAllTimersAsync();
        expect(activeOf.home!()).toBe(true);
    });
});

describe('the edge swipe offers itself to back interceptors (#1312)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const mountPushed = async () => {
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home">
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        act(() => { probe.nav!.push('settings'); });
        await vi.runAllTimersAsync();
        return { probe, container: result.container };
    };

    it('keeps the interactive handle while nothing is registered', async () => {
        const { container } = await mountPushed();
        expect(edgeHandle(container)).not.toBeNull();
        expect(interceptStrip(container)).toBeNull();
    });

    it('a consumed swipe never navigates', async () => {
        const { probe, container } = await mountPushed();
        let calls = 0;
        const off = addBackInterceptor(() => { calls++; return true; });
        try {
            await vi.runAllTimersAsync();
            const strip = interceptStrip(container);
            expect(strip).not.toBeNull();
            expect(edgeHandle(container)).toBeNull();
            act(() => swipe(strip!, 200));
            await vi.runAllTimersAsync();
            expect(calls).toBe(1);
            expect(probe.nav!.current.route).toBe('settings');
        } finally {
            off();
        }
        await vi.runAllTimersAsync();
        expect(interceptStrip(container)).toBeNull();
        expect(edgeHandle(container)).not.toBeNull();
    });

    it('an unconsumed swipe pops; a short drag does nothing', async () => {
        const { probe, container } = await mountPushed();
        const off = addBackInterceptor(() => false);
        try {
            await vi.runAllTimersAsync();
            const strip = interceptStrip(container)!;
            act(() => swipe(strip, 10));
            await vi.runAllTimersAsync();
            expect(probe.nav!.current.route).toBe('settings');
            act(() => swipe(strip, 200));
            await vi.runAllTimersAsync();
            expect(probe.nav!.current.route).toBe('home');
        } finally {
            off();
        }
    });
});
