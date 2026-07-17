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
import { render, act, TestNode } from '@sigx/lynx-testing';
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

/**
 * Animated navigator — the sheet SV exists, so the present-at-detent (#711b)
 * and dismiss-reset paths are exercisable. Under lynx-testing's eager flush
 * the `<Screen snapPoints>` registration lands synchronously, so a
 * non-animated sheet push takes the synchronous jump path.
 */
function renderRootAnimated(): NavProbe {
    const probe: NavProbe = { nav: null, internals: null };
    render(
        <NavigationRoot routes={routes} initialRoute="home">
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
        // dragHandle not declared → absent from the registry; the Stack's
        // sheetConfigFor defaults it to 'surface' (full-body drag).
        expect(reg.options.dragHandle).toBeUndefined();
    });

    it('registers dragHandle from <Screen> into the entry registry', () => {
        const probe = renderRoot();
        act(() => probe.nav!.push('grabberSheet'));
        const reg = probe.internals!.screens.get(probe.nav!.current.key)!;
        expect(reg.options.dragHandle).toBe('grabber');
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

describe('Sheet presentation — present at detent (#711b)', () => {
    // FilterSheet: snapPoints [0.4, 0.9], initialSnapIndex 0 →
    // progress = 0.4 / 0.9 (snapToProgress).
    const DETENT = 0.4 / 0.9;

    it('a non-animated sheet push jumps the SV to the initial detent (no slide)', () => {
        const probe = renderRootAnimated();
        const sv = probe.internals!.sheetProgress!;
        expect(sv).toBeTruthy();

        act(() => probe.nav!.push('filterSheet', undefined, { animated: false }));

        // Present-at-detent: the SV lands on the resting height synchronously
        // (registry visible under the eager flush), and no transition runs.
        expect(sv.current.value).toBeCloseTo(DETENT, 5);
        expect(probe.nav!.transition).toBeNull();
        expect(probe.nav!.current.route).toBe('filterSheet');
    });

    it('an animated sheet push does NOT jump — it runs a transition from 0', () => {
        const probe = renderRootAnimated();
        const sv = probe.internals!.sheetProgress!;

        act(() => probe.nav!.push('filterSheet'));

        // Distinguishes the animated branch: a transition is in flight and the
        // SV is seeded at 0 to slide up (vs the non-animated jump to DETENT).
        expect(probe.nav!.transition).not.toBeNull();
        expect(sv.current.value).toBe(0);
    });

    it('a non-animated dismiss resets the sheet SV to 0', () => {
        const probe = renderRootAnimated();
        const sv = probe.internals!.sheetProgress!;
        act(() => probe.nav!.push('filterSheet', undefined, { animated: false }));
        expect(sv.current.value).toBeCloseTo(DETENT, 5);

        act(() => probe.nav!.pop(1, { animated: false }));

        // No sheet left on the stack → the SV must be 0 so `useSheetHeight`
        // reports 0 (else a bar bound to it hangs at the last detent height).
        expect(sv.current.value).toBe(0);
        expect(probe.nav!.current.route).toBe('home');
    });
});

describe('Sheet presentation — backdrop: false (inline / non-modal)', () => {
    // The backdrop is the only full-screen element covering the region above
    // the sheet surface (the sheet's own layer is translated down to its top
    // edge). Its `#000` absolute fill uniquely identifies it in the tree.
    const findBackdrop = (node: TestNode): TestNode | null => {
        if (
            node.type === 'view'
            && node._style['position'] === 'absolute'
            && node._style['backgroundColor'] === '#000'
        ) return node;
        for (const child of node.children) {
            const hit = findBackdrop(child);
            if (hit) return hit;
        }
        return null;
    };

    function renderWithContainer(): { probe: NavProbe; container: TestNode } {
        const probe: NavProbe = { nav: null, internals: null };
        const { container } = render(
            <NavigationRoot routes={routes} initialRoute="home">
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        return { probe, container };
    }

    it('a default sheet renders the backdrop displayed and tap-catching', () => {
        const { probe, container } = renderWithContainer();
        act(() => probe.nav!.push('filterSheet', undefined, { animated: false }));
        const bd = findBackdrop(container);
        expect(bd).toBeTruthy();
        expect(bd!._style['display']).not.toBe('none');   // dims the screen
        expect(bd!._handlers.has('catchtap')).toBe(true);  // consumes taps
    });

    it('backdrop:false renders the backdrop inert (display:none → pass-through)', () => {
        const { probe, container } = renderWithContainer();
        act(() => probe.nav!.push('panelSheet', undefined, { animated: false }));
        const bd = findBackdrop(container);
        expect(bd).toBeTruthy();
        // display:none: not laid out, catches no taps — the composer bar in
        // the screen below stays interactive while the sheet is open.
        expect(bd!._style['display']).toBe('none');
    });

    it('backdrop:false disarms backdrop-tap-dismiss even if the handler fires', () => {
        const { probe, container } = renderWithContainer();
        act(() => probe.nav!.push('panelSheet', undefined, { animated: false }));
        expect(probe.nav!.current.route).toBe('panelSheet');
        const bd = findBackdrop(container)!;
        // Invoking the (inert) catchtap must not pop — the `enabled` gate.
        act(() => { bd._handlers.get('catchtap')?.({}); });
        expect(probe.nav!.current.route).toBe('panelSheet');
    });

    it('present-at-detent (#711b) and useSheetHeight still work with backdrop off', () => {
        const { probe } = renderWithContainer();
        const sv = probe.internals!.sheetProgress!;
        act(() => probe.nav!.push('panelSheet', undefined, { animated: false }));
        // snapPoints [0.4, 0.9], initialSnapIndex 0 → progress 0.4/0.9.
        expect(sv.current.value).toBeCloseTo(0.4 / 0.9, 5);
        expect(probe.nav!.transition).toBeNull();
        act(() => probe.nav!.pop(1, { animated: false }));
        expect(sv.current.value).toBe(0);
    });
});
