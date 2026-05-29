/**
 * Regression tests for issue #121 — `<Stack>` must not remount screen
 * subtrees during push/pop animations.
 *
 * Before the fix, a single animated push mounted the target screen ~3×
 * (static → animated → static) because (a) the layer render key embedded the
 * animation variant, so flipping animated↔static re-keyed and remounted the
 * whole `<Layer>` + `<EntryScope>` + screen, and (b) `push()` wrote `stack`
 * then `transition` unbatched, producing an intermediate idle render that
 * dropped + re-mounted the underneath. The fix keys layers by entry only,
 * rebinds the transform reactively, and batches the stack+transition writes.
 *
 * These tests run with `animated={true}` (the default) — the only path that
 * exhibits the bug. We drive the real ~280ms settle with real timers and
 * count mounts/unmounts via `onMounted` / `onUnmounted`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { component, onMounted, onUnmounted } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
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

/** Wait out a duration on real timers, then flush pending reactive updates. */
function settle(ms = 380): Promise<void> {
    return act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    });
}

describe('Stack remount (issue #121)', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('animated card push mounts the target screen exactly once through settle', async () => {
        const homeCounter: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const targetCounter: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const localRoutes = defineRoutes({
            home: { component: makeCountedScreen(homeCounter, 'Home') },
            target: { component: makeCountedScreen(targetCounter, 'Target') },
        });
        const probe: NavProbe = { nav: null };

        render(
            <NavigationRoot routes={localRoutes as never} initialRoute={'home' as never}>
                <Capture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        expect(homeCounter.mounts).toBe(1);
        expect(targetCounter.mounts).toBe(0);

        await act(() => { probe.nav!.push('target' as never); });

        // The target mounts once when the push commits (stack + transition in
        // one batched render). The underneath (home) must still be mounted —
        // not torn down by an intermediate idle render.
        expect(targetCounter.mounts).toBe(1);
        expect(homeCounter.mounts).toBe(1);
        expect(homeCounter.unmounts).toBe(0);

        await settle();

        // After the slide settles the target is the sole visible base. It
        // must NOT have remounted when its layer flipped animated → static.
        expect(targetCounter.mounts).toBe(1);
        // With card-stack retention (issue #124) the underneath stays
        // mounted as a hidden layer beneath the top — it mounts once and is
        // never torn down, so popping back reveals it with state intact.
        expect(homeCounter.mounts).toBe(1);
        expect(homeCounter.unmounts).toBe(0);
        expect(probe.nav!.current.route).toBe('target');
        expect(probe.nav!.transition).toBe(null);
    });

    it('animated modal push keeps the underneath mounted (no teardown)', async () => {
        const homeCounter: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const sheetCounter: LifecycleCounter = { mounts: 0, unmounts: 0 };
        const localRoutes = defineRoutes({
            home: { component: makeCountedScreen(homeCounter, 'Home') },
            sheet: {
                component: makeCountedScreen(sheetCounter, 'Sheet'),
                presentation: 'modal',
            },
        });
        const probe: NavProbe = { nav: null };

        render(
            <NavigationRoot routes={localRoutes as never} initialRoute={'home' as never}>
                <Capture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        expect(homeCounter.mounts).toBe(1);

        await act(() => { probe.nav!.push('sheet' as never); });
        await settle();

        // The modal mounts exactly once...
        expect(sheetCounter.mounts).toBe(1);
        // ...and the underneath is never torn down — modal keeps its
        // background mounted through and after the transition.
        expect(homeCounter.mounts).toBe(1);
        expect(homeCounter.unmounts).toBe(0);
        expect(probe.nav!.current.route).toBe('sheet');
    });
});
