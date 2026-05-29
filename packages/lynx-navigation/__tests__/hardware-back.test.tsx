/**
 * Tests for Android hardware/system back wiring (issue #127).
 *
 * `<NavigationRoot>` auto-wires the hardware-back handler by default, so the
 * OS back gesture pops the focused stack with no app-side boilerplate. The
 * `hardwareBack={false}` prop opts out, and `wireHardwareBack` is idempotent
 * per navigator tree so an app that *also* calls `useHardwareBack()` never
 * double-pops.
 *
 * `BackHandler` reads `lynx.getJSModule('GlobalEventEmitter')` at
 * registration time; we stub a fake emitter (same shape as the safe-area /
 * websocket tests) so the test can fire a synthetic `hardwareBackPress`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { useNav } from '../src/hooks/use-nav';
import { useHardwareBack } from '../src/hooks/use-hardware-back';
import type { Nav } from '../src/hooks/use-nav';
import { defineRoutes } from '../src/define-routes';

const BACK_EVENT = 'hardwareBackPress';

interface MockEmitter {
    listeners: Map<string, Set<(...a: unknown[]) => void>>;
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
    fire: (name: string) => void;
    count: (name: string) => number;
}

function makeEmitter(): MockEmitter {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
    return {
        listeners,
        addListener(name, fn) {
            let set = listeners.get(name);
            if (!set) { set = new Set(); listeners.set(name, set); }
            set.add(fn);
        },
        removeListener(name, fn) { listeners.get(name)?.delete(fn); },
        fire(name) { for (const fn of listeners.get(name) ?? []) fn(); },
        count(name) { return listeners.get(name)?.size ?? 0; },
    };
}

let emitter: MockEmitter;

beforeEach(() => {
    emitter = makeEmitter();
    (globalThis as { lynx?: unknown }).lynx = {
        getJSModule: (name: string) => (name === 'GlobalEventEmitter' ? emitter : undefined),
    };
});

afterEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

interface NavProbe { nav: Nav | null }
const Capture = component<{ probe: NavProbe } & {}>(({ props }) => {
    props.probe.nav = useNav();
    return () => null;
});

const routes = defineRoutes({
    a: { component: component(() => () => <view><text>A</text></view>) },
    b: { component: component(() => () => <view><text>B</text></view>) },
    c: { component: component(() => () => <view><text>C</text></view>) },
});

describe('hardware back wiring (issue #127)', () => {
    it('auto-wires by default — a back press pops the stack', () => {
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={routes as never} initialRoute={'a' as never} animated={false}>
                <Capture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        // A listener was registered without the app wiring anything.
        expect(emitter.count(BACK_EVENT)).toBe(1);

        act(() => { probe.nav!.push('b' as never); });
        expect(probe.nav!.current.route).toBe('b');

        act(() => { emitter.fire(BACK_EVENT); });
        expect(probe.nav!.current.route).toBe('a');

        result.unmount();
        // Cleanup unsubscribes.
        expect(emitter.count(BACK_EVENT)).toBe(0);
    });

    it('does not wire when hardwareBack={false}', () => {
        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot
                routes={routes as never}
                initialRoute={'a' as never}
                animated={false}
                hardwareBack={false}
            >
                <Capture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        expect(emitter.count(BACK_EVENT)).toBe(0);

        act(() => { probe.nav!.push('b' as never); });
        act(() => { emitter.fire(BACK_EVENT); });
        // No listener — the press is a no-op, the stack stays put.
        expect(probe.nav!.current.route).toBe('b');

        result.unmount();
    });

    it('opt-out + manual useHardwareBack() still pops', () => {
        const probe: NavProbe = { nav: null };
        const Wiring = component(() => { useHardwareBack(); return () => null; });
        const result = render(
            <NavigationRoot
                routes={routes as never}
                initialRoute={'a' as never}
                animated={false}
                hardwareBack={false}
            >
                <Capture probe={probe} />
                <Wiring />
                <Stack />
            </NavigationRoot>,
        );

        expect(emitter.count(BACK_EVENT)).toBe(1);
        act(() => { probe.nav!.push('b' as never); });
        act(() => { emitter.fire(BACK_EVENT); });
        expect(probe.nav!.current.route).toBe('a');

        result.unmount();
    });

    it('is idempotent — auto-wire + manual hook registers once and pops once', () => {
        const probe: NavProbe = { nav: null };
        const Wiring = component(() => { useHardwareBack(); return () => null; });
        const result = render(
            <NavigationRoot routes={routes as never} initialRoute={'a' as never} animated={false}>
                <Capture probe={probe} />
                <Wiring />
                <Stack />
            </NavigationRoot>,
        );

        // Default auto-wire + the manual hook share one tree → one listener.
        expect(emitter.count(BACK_EVENT)).toBe(1);

        act(() => { probe.nav!.push('b' as never); });
        act(() => { probe.nav!.push('c' as never); });
        expect(probe.nav!.current.route).toBe('c');

        // A single press pops exactly one level (not two).
        act(() => { emitter.fire(BACK_EVENT); });
        expect(probe.nav!.current.route).toBe('b');

        result.unmount();
        expect(emitter.count(BACK_EVENT)).toBe(0);
    });
});
