/**
 * Regression tests for issue #758 — a transition must LAND on its target,
 * even when the main-thread tween doesn't finish in time.
 *
 * The bug: `animateProgress` dispatches `withTiming` to the MT and then waits
 * the duration on BG with a wall-clock timer. When the MT is busy building the
 * incoming screen (long lists, native layout), the tween is still mid-slide
 * when that timer fires. The caller settles the layer, which unregisters its
 * animated style binding — and the partial transform stays on the element,
 * because the BG-side style diff never knew about it. The screen rests tens of
 * pixels off, permanently, with the previous one visible through the gap.
 *
 * These tests pin the fix: after a transition completes, the progress
 * SharedValue holds the target, not wherever the tween happened to be.
 *
 * `withTiming` is stubbed to a no-op so the SharedValue never reaches the
 * target on its own — the same end state as an MT tween starved by the
 * incoming screen's construction. Without the landing write these tests strand
 * the value at the pre-stage seed, which is the bug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => ({ timings: [] as number[], cancels: 0 }));

// Stub ONLY the tween: it records the intent and moves nothing, so the value
// "never lands" on its own. `cancelAnimation` keeps its real behavior and is
// merely counted — the landing path depends on it actually cancelling.
// Everything else in lynx-motion stays real (this module graph pulls in the
// sheet/drag machinery too).
vi.mock('@sigx/lynx-motion', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx-motion')>();
    return {
        ...actual,
        withTiming: (_sv: unknown, target: number) => {
            motion.timings.push(target);
            return Promise.resolve();
        },
        cancelAnimation: (...args: Parameters<typeof actual.cancelAnimation>) => {
            motion.cancels += 1;
            return actual.cancelAnimation(...args);
        },
    };
});
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { useNav } from '../src/hooks/use-nav';
import { useNavInternals } from '../src/hooks/use-nav-internal';
import type { Nav } from '../src/hooks/use-nav';
import type { NavInternals } from '../src/hooks/use-nav-internal';
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

/** Animated navigator — the only path that runs transitions. */
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

/** MT-side value of a progress SV (BG `.value` is the published mirror). */
function mtValue(sv: { current: { value: number } } | null): number | null {
    return sv ? sv.current.value : null;
}

/**
 * Let the pre-stage window, the transition's wall-clock wait, the landing
 * dispatch and its ack all run. Real timers (like `remount.test.tsx`): the
 * pre-stage loop polls `Date.now()`, which fake timers freeze.
 */
function settleTransition(ms = 600): Promise<void> {
    return act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
    });
}

describe('transition landing (#758)', () => {
    // Per-test isolation: the recorder is module-hoisted, so without this the
    // assertions would depend on execution order.
    beforeEach(() => {
        motion.timings.length = 0;
        motion.cancels = 0;
    });

    it('a modal push lands progress on 1 even when the tween never advances', async () => {
        const probe = renderRootAnimated();
        const sv = probe.internals!.progress!;
        expect(sv).toBeTruthy();

        await act(() => {
            probe.nav!.push('composeMessage', { recipientId: 'u1' });
        });
        // Parked with the pre-stage sliver — the screen is mounted but not
        // presented, which is where the bug used to strand it.
        expect(mtValue(sv)).toBeLessThan(0.5);

        await settleTransition();

        // The tween was asked for 1 but moved nothing; the landing write is
        // what puts the screen at rest — and it cancels first, so a late tick
        // can't drag it back off.
        expect(motion.timings).toContain(1);
        expect(motion.cancels).toBeGreaterThan(0);
        expect(mtValue(sv)).toBe(1);
    });

    it('a card push lands progress on 1', async () => {
        const probe = renderRootAnimated();
        const sv = probe.internals!.progress!;

        await act(() => {
            probe.nav!.push('settings');
        });
        await settleTransition();

        expect(mtValue(sv)).toBe(1);
    });

    it('a pop lands progress on its endpoint', async () => {
        const probe = renderRootAnimated();
        const sv = probe.internals!.progress!;

        await act(() => {
            probe.nav!.push('settings');
        });
        await settleTransition();
        expect(probe.nav!.current.route).toBe('settings');

        await act(() => {
            probe.nav!.pop();
        });
        await settleTransition();

        expect(probe.nav!.current.route).toBe('home');
        expect(mtValue(sv)).toBe(1);
    });

    it('a sheet push lands on its snap target, not part-way', async () => {
        const probe = renderRootAnimated();
        const sheetSv = probe.internals!.sheetProgress!;
        expect(sheetSv).toBeTruthy();

        await act(() => {
            probe.nav!.push('filterSheet');
        });
        await settleTransition();

        // The fixture sheet rests at its initial snap; the exact fraction is
        // the registry's business — what matters is that it is not stranded
        // at the 0 seed the push started from.
        expect(mtValue(sheetSv)).toBeGreaterThan(0);
    });
});
