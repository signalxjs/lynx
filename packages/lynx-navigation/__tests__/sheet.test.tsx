/**
 * `presentation: 'sheet'` tests.
 *
 * A sheet is a stack entry like a modal — partial-height, snap points,
 * built-in backdrop, drag-to-dismiss (the gesture itself is MT-only; its
 * decision logic is covered in `sheet-math.test.ts`, the layer/animation
 * plan in `layer-plan.test.ts`). What we lock in here is the BG-side stack
 * model:
 *  - Route-level and per-call `presentation: 'sheet'` land on the entry.
 *  - `<Screen snapPoints initialSnapIndex backdropDismiss>` registers.
 *  - `nav.pop()` / `dismiss()` / hardware back pop a sheet.
 *  - Sheet pushes escalate from nested stacks to root (like modals).
 *  - `commitSheetDismiss` (the drag-dismiss commit) pops exactly the top
 *    sheet and no-ops otherwise.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { Tabs } from '../src/components/Tabs';
import { useNav } from '../src/hooks/use-nav';
import { useNavInternals, type NavInternals } from '../src/hooks/use-nav-internal';
import type { Nav } from '../src/hooks/use-nav';
import { routes } from './_fixtures';

interface NavProbe {
    nav: Nav | null;
    internals: NavInternals | null;
}

const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    props.probe.nav = useNav();
    props.probe.internals = useNavInternals();
    return () => null;
});

function renderRoot(): NavProbe {
    const probe: NavProbe = { nav: null, internals: null };
    render(
        <NavigationRoot routes={routes} initialRoute="home" animated={false}>
            <NavCapture probe={probe} />
            <Stack />
        </NavigationRoot>,
    );
    return probe;
}

describe('Sheet presentation — stack model', () => {
    it('marks the entry with route-level `presentation: "sheet"`', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('filterSheet'));
        expect(probe.nav!.current.route).toBe('filterSheet');
        expect(probe.nav!.current.presentation).toBe('sheet');
    });

    it('per-call options.presentation: "sheet" overrides the route default', () => {
        const probe = renderRoot();
        act(() =>
            probe.nav!.push('settings', undefined, { presentation: 'sheet' }),
        );
        expect(probe.nav!.current.presentation).toBe('sheet');
    });

    it('registers snap config from <Screen> into the entry registry', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('filterSheet'));
        const reg = probe.internals!.screens.get(probe.nav!.current.key)!;
        expect(reg).toBeTruthy();
        // FilterSheet declares <Screen snapPoints={[0.4, 0.9]} initialSnapIndex={0}>.
        expect(reg.options.snapPoints).toEqual([0.4, 0.9]);
        expect(reg.options.initialSnapIndex).toBe(0);
    });

    it('nav.pop() dismisses the sheet back to the underlying screen', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('filterSheet'));
        expect(probe.nav!.stack.length).toBe(2);

        act(() => probe.nav!.pop());

        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });

    it('dismiss() pops a sheet back to the nearest card entry', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('profile', { id: '7' }));
        act(() => probe.nav!.push('filterSheet'));
        expect(probe.nav!.stack.length).toBe(3);

        act(() => probe.nav!.dismiss());

        expect(probe.nav!.stack.length).toBe(2);
        expect(probe.nav!.current.route).toBe('profile');
    });

    it('dismiss() collapses a sheet stacked on a modal in one call', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('composeMessage', { recipientId: 'a' }));
        act(() => probe.nav!.push('filterSheet'));
        expect(probe.nav!.stack.length).toBe(3);

        act(() => probe.nav!.dismiss());

        // Both overlay entries (modal + sheet) sit above the card base —
        // dismiss() slices them all off.
        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });

    it('commitSheetDismiss pops exactly the top sheet (the drag-dismiss commit)', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('filterSheet'));
        expect(probe.nav!.stack.length).toBe(2);

        act(() => probe.internals!.commitSheetDismiss());

        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });

    it('commitSheetDismiss with a stale entry key is a no-op (race guard)', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('filterSheet'));
        const before = probe.nav!.stack.length;

        // The drag-dismiss commit arrives via a BG timeout — if a different
        // sheet became top meanwhile, the stale key must not pop it.
        act(() => probe.internals!.commitSheetDismiss('entry-stale-xyz'));
        expect(probe.nav!.stack.length).toBe(before);

        // The matching key commits.
        act(() => probe.internals!.commitSheetDismiss(probe.nav!.current.key));
        expect(probe.nav!.stack.length).toBe(before - 1);
    });

    it('commitSheetDismiss is a no-op when the top entry is not a sheet', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('profile', { id: '7' }));
        const before = probe.nav!.stack.length;

        act(() => probe.internals!.commitSheetDismiss());

        expect(probe.nav!.stack.length).toBe(before);
        expect(probe.nav!.current.route).toBe('profile');
    });
});

describe('Sheet presentation — escalation from nested stacks', () => {
    it('sheet push from a nested per-tab stack escalates to root', () => {
        const innerProbe: NavProbe = { nav: null, internals: null };
        const HomeTab = component(() => () => (
            <view>
                <NavCapture probe={innerProbe} />
                <text>home-tab</text>
            </view>
        ));
        const rs = {
            ...routes,
            homeTab: { component: HomeTab },
            root: {
                component: component(() => () => (
                    <Tabs initialTab="main">
                        <Tabs.Screen name="main">
                            <Stack initialRoute="homeTab" />
                        </Tabs.Screen>
                    </Tabs>
                )),
            },
        } as never;

        const rootProbe: NavProbe = { nav: null, internals: null };
        render(
            <NavigationRoot routes={rs} initialRoute={'root' as never} animated={false}>
                <NavCapture probe={rootProbe} />
                <Stack />
            </NavigationRoot>,
        );

        expect(innerProbe.nav).not.toBe(null);
        act(() => innerProbe.nav!.push('filterSheet'));

        // Inner stack untouched; the sheet landed on root.
        expect(innerProbe.nav!.stack.length).toBe(1);
        expect(rootProbe.nav!.stack.length).toBe(2);
        expect(rootProbe.nav!.current.route).toBe('filterSheet');
        expect(rootProbe.nav!.current.presentation).toBe('sheet');
    });
});

describe('Sheet presentation — hardware back', () => {
    interface MockEmitter {
        addListener: (name: string, fn: (...a: unknown[]) => void) => void;
        removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
        fire: (name: string) => void;
    }

    let emitter: MockEmitter;

    beforeEach(() => {
        const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
        emitter = {
            addListener(name, fn) {
                let set = listeners.get(name);
                if (!set) { set = new Set(); listeners.set(name, set); }
                set.add(fn);
            },
            removeListener(name, fn) { listeners.get(name)?.delete(fn); },
            fire(name) { for (const fn of listeners.get(name) ?? []) fn(); },
        };
        (globalThis as { lynx?: unknown }).lynx = {
            getJSModule: (name: string) =>
                name === 'GlobalEventEmitter' ? emitter : undefined,
        };
    });

    afterEach(() => {
        delete (globalThis as { lynx?: unknown }).lynx;
    });

    it('a hardware back press pops the top sheet', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('filterSheet'));
        expect(probe.nav!.current.route).toBe('filterSheet');

        act(() => emitter.fire('hardwareBackPress'));

        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });
});
