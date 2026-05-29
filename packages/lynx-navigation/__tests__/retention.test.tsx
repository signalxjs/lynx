/**
 * Integration tests for issue #124 — card-stack screen retention.
 *
 * Covered cards must stay mounted (hidden) beneath the visible top so
 * back-navigation reveals them instantly with state intact, instead of
 * unmounting at idle and rebuilding on pop-back. This is the at-idle
 * counterpart to the during-transition fix in `remount.test.tsx` (#121).
 *
 * We count mounts/unmounts via `onMounted` / `onUnmounted`. The headline
 * guarantee is **mounts === 1 for every screen across a full push/pop
 * round-trip** (no rebuild). A screen that is genuinely popped off the
 * stack unmounts exactly once; a retained base/underneath never unmounts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { component, onMounted, onUnmounted } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { Tabs, useTabs, type TabsNav } from '../src/components/Tabs';
import { useNav } from '../src/hooks/use-nav';
import type { Nav } from '../src/hooks/use-nav';
import { defineRoutes } from '../src/define-routes';

interface NavProbe { nav: Nav | null }

const Capture = component<{ probe: NavProbe } & {}>(({ props }) => {
    const nav = useNav();
    props.probe.nav = nav;
    return () => null;
});

interface LifecycleCounter { mounts: number; unmounts: number }

/** A screen that records its mount/unmount lifecycle into `counter`. */
function makeCountedScreen(counter: LifecycleCounter, label: string) {
    return component(() => {
        onMounted(() => { counter.mounts += 1; });
        onUnmounted(() => { counter.unmounts += 1; });
        return () => <view><text>{label}</text></view>;
    });
}

/**
 * A screen that records its lifecycle AND publishes its (possibly nested)
 * nav into a probe, so a test can push from inside the screen's nav scope.
 */
function makeCapturingScreen(counter: LifecycleCounter, probe: NavProbe, label: string) {
    return component(() => {
        const nav = useNav();
        probe.nav = nav;
        onMounted(() => { counter.mounts += 1; });
        onUnmounted(() => { counter.unmounts += 1; });
        return () => <view><text>{label}</text></view>;
    });
}

/** Wait out a duration on real timers, then flush pending reactive updates. */
function settle(ms = 380): Promise<void> {
    return act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    });
}

describe('Stack card retention (issue #124)', () => {
    beforeEach(() => { vi.useRealTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('mounts each screen exactly once across an animated A→B→C push then pop back', async () => {
        const aC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const bC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const cC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const localRoutes = defineRoutes({
            a: { component: makeCountedScreen(aC, 'A') },
            b: { component: makeCountedScreen(bC, 'B') },
            c: { component: makeCountedScreen(cC, 'C') },
        });
        const probe: NavProbe = { nav: null };

        render(
            <NavigationRoot routes={localRoutes as never} initialRoute={'a' as never}>
                <Capture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        await act(() => { probe.nav!.push('b' as never); });
        await settle();
        await act(() => { probe.nav!.push('c' as never); });
        await settle();

        // All three mounted once; A and B were never torn down while covered.
        expect(aC.mounts).toBe(1);
        expect(bC.mounts).toBe(1);
        expect(cC.mounts).toBe(1);
        expect(aC.unmounts).toBe(0);
        expect(bC.unmounts).toBe(0);

        // Pop C→B then B→A. The revealed underneath must NOT remount.
        await act(() => { probe.nav!.pop(); });
        await settle();
        await act(() => { probe.nav!.pop(); });
        await settle();

        expect(probe.nav!.current.route).toBe('a');
        // No rebuild: each screen mounted exactly once for its whole life.
        expect(aC.mounts).toBe(1);
        expect(bC.mounts).toBe(1);
        expect(cC.mounts).toBe(1);
        // The retained base never unmounts; popped screens unmount once each.
        expect(aC.unmounts).toBe(0);
        expect(bC.unmounts).toBe(1);
        expect(cC.unmounts).toBe(1);
    });

    it('reveals the root instantly on popToRoot without rebuilding it', async () => {
        const aC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const bC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const cC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const localRoutes = defineRoutes({
            a: { component: makeCountedScreen(aC, 'A') },
            b: { component: makeCountedScreen(bC, 'B') },
            c: { component: makeCountedScreen(cC, 'C') },
        });
        const probe: NavProbe = { nav: null };

        render(
            <NavigationRoot routes={localRoutes as never} initialRoute={'a' as never}>
                <Capture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        await act(() => { probe.nav!.push('b' as never); });
        await settle();
        await act(() => { probe.nav!.push('c' as never); });
        await settle();

        await act(() => { probe.nav!.popToRoot(); });
        await settle();

        expect(probe.nav!.current.route).toBe('a');
        // A was retained mounted the whole time — revealed, not rebuilt.
        expect(aC.mounts).toBe(1);
        expect(aC.unmounts).toBe(0);
        // The intermediate cards are gone.
        expect(bC.unmounts).toBe(1);
        expect(cC.unmounts).toBe(1);
    });

    it('reveals the destination of a multi-step pop without rebuilding it', async () => {
        const aC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const bC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const cC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const localRoutes = defineRoutes({
            a: { component: makeCountedScreen(aC, 'A') },
            b: { component: makeCountedScreen(bC, 'B') },
            c: { component: makeCountedScreen(cC, 'C') },
        });
        const probe: NavProbe = { nav: null };

        render(
            <NavigationRoot routes={localRoutes as never} initialRoute={'a' as never}>
                <Capture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        await act(() => { probe.nav!.push('b' as never); });
        await settle();
        await act(() => { probe.nav!.push('c' as never); });
        await settle();

        // pop(count>1) is instant — destination A is already mounted.
        await act(() => { probe.nav!.pop(2); });
        await settle();

        expect(probe.nav!.current.route).toBe('a');
        expect(aC.mounts).toBe(1);
        expect(aC.unmounts).toBe(0);
    });

    it('keeps a covered card mounted across a replace of the top', async () => {
        const aC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const bC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const dC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const localRoutes = defineRoutes({
            a: { component: makeCountedScreen(aC, 'A') },
            b: { component: makeCountedScreen(bC, 'B') },
            d: { component: makeCountedScreen(dC, 'D') },
        });
        const probe: NavProbe = { nav: null };

        render(
            <NavigationRoot routes={localRoutes as never} initialRoute={'a' as never}>
                <Capture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        await act(() => { probe.nav!.push('b' as never); });
        await settle();

        // Replace the top B with D. A is covered and must stay mounted; the
        // replaced top legitimately swaps (B unmounts, D mounts).
        await act(() => { probe.nav!.replace('d' as never); });
        await settle();

        expect(probe.nav!.current.route).toBe('d');
        expect(aC.mounts).toBe(1);
        expect(aC.unmounts).toBe(0);
        expect(bC.unmounts).toBe(1);
        expect(dC.mounts).toBe(1);
    });

    it('keeps a per-tab stack mounted (covered cards + base) across tab switches', async () => {
        // Nested per-tab stacks each run their own computeLayers; retention
        // is per-navigator and composes with the tab-level display:none.
        const t1HomeC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const t1CardC: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const t1Probe: NavProbe = { nav: null };
        const localRoutes = defineRoutes({
            root: { component: makeCountedScreen({ mounts: 0, unmounts: 0 }, 'Root') },
            t1home: { component: makeCapturingScreen(t1HomeC, t1Probe, 'T1Home') },
            t1card: { component: makeCountedScreen(t1CardC, 'T1Card') },
            t2home: { component: makeCountedScreen({ mounts: 0, unmounts: 0 }, 'T2Home') },
        });
        const tabsProbe: { nav: TabsNav | null } = { nav: null };
        const TabsCapture = component<{ probe: typeof tabsProbe } & {}>(({ props }) => {
            props.probe.nav = useTabs();
            return () => null;
        });

        render(
            <NavigationRoot routes={localRoutes as never} initialRoute={'root' as never} animated={false}>
                <Tabs initialTab="t1">
                    <TabsCapture probe={tabsProbe} />
                    <Tabs.Screen name="t1"><Stack initialRoute={'t1home' as never} /></Tabs.Screen>
                    <Tabs.Screen name="t2"><Stack initialRoute={'t2home' as never} /></Tabs.Screen>
                </Tabs>
            </NavigationRoot>,
        );

        // Push a card inside tab 1's stack (instant — animated={false}).
        await act(() => { t1Probe.nav!.push('t1card' as never); });

        expect(t1HomeC.mounts).toBe(1);
        expect(t1CardC.mounts).toBe(1);

        // Switch to tab 2 and back. Tab 1's stack (home retained hidden +
        // covering card) must survive — nothing rebuilds.
        await act(() => { tabsProbe.nav!.setActive('t2'); });
        await act(() => { tabsProbe.nav!.setActive('t1'); });

        expect(t1HomeC.mounts).toBe(1);
        expect(t1HomeC.unmounts).toBe(0);
        expect(t1CardC.mounts).toBe(1);
        expect(t1CardC.unmounts).toBe(0);
    });
});
