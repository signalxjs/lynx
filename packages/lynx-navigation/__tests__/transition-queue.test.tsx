/**
 * Regression tests for issue #849 — navigation requested mid-transition must
 * be replayed, not silently dropped.
 *
 * A transition outlives its own slide: `animateProgress` awaits a main-thread
 * landing ack after the wall-clock duration elapses. So a press arriving once
 * the animation LOOKS finished could still hit the `isTransitioning()` guard
 * and vanish. On device that read as a dead tap — the row's selection haptic
 * fired and nothing happened, and only a second tap worked.
 *
 * These tests pin the replay, and pin that it can't over-navigate: a second
 * impatient tap must not stack a duplicate screen or pop an extra one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { useNav } from '../src/hooks/use-nav';
import type { Nav } from '../src/hooks/use-nav';
import { routes } from './_fixtures';

interface NavProbe {
    nav: Nav | null;
}

const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    props.probe.nav = useNav();
    return () => null;
});

/**
 * Drive the transition to completion on fake timers. Runs pending timers to
 * exhaustion rather than advancing a guessed duration, so the tests don't have
 * to track the settle window or slide duration. The async form interleaves the
 * awaited microtasks (settle, landing ack, replay hop) with the timer steps.
 */
const settled = async (): Promise<void> => {
    await vi.runAllTimersAsync();
};

function mount(): NavProbe {
    const probe: NavProbe = { nav: null };
    render(
        <NavigationRoot routes={routes} initialRoute="home">
            <NavCapture probe={probe} />
            <Stack />
        </NavigationRoot>,
    );
    return probe;
}

const routeNames = (probe: NavProbe): string[] =>
    probe.nav!.stack.map((e) => e.route);

describe('navigation queued during a transition (#849)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('replays a push requested mid-transition instead of dropping it', async () => {
        const probe = mount();

        act(() => { probe.nav!.push('settings'); });
        expect(probe.nav!.transition).not.toBeNull();

        // Arrives while the slide is still running — previously discarded.
        act(() => { probe.nav!.push('profile', { id: '7' }, { tab: 'posts' }); });

        await settled();
        expect(probe.nav!.transition).toBeNull();
        expect(routeNames(probe)).toEqual(['home', 'settings', 'profile']);
    });

    it('does not stack a duplicate when the same route is tapped twice', async () => {
        const probe = mount();

        act(() => { probe.nav!.push('settings'); });
        // The impatient second tap on the same row.
        act(() => { probe.nav!.push('settings'); });

        await settled();
        expect(routeNames(probe)).toEqual(['home', 'settings']);
    });

    it('does not pop an extra screen when back is pressed twice', async () => {
        const probe = mount();
        act(() => { probe.nav!.push('settings'); });
        await settled();
        act(() => { probe.nav!.push('profile', { id: '7' }, { tab: 'posts' }); });
        await settled();
        expect(routeNames(probe)).toEqual(['home', 'settings', 'profile']);

        act(() => { probe.nav!.pop(); });
        // Second back press while the first pop is still animating: the screen
        // it meant to dismiss is already leaving, so it must be a no-op.
        act(() => { probe.nav!.pop(); });

        await settled();
        expect(routeNames(probe)).toEqual(['home', 'settings']);
    });

    it('replays a queued intent exactly once', async () => {
        const probe = mount();

        act(() => { probe.nav!.push('settings'); });
        act(() => { probe.nav!.push('profile', { id: '7' }, { tab: 'posts' }); });
        await settled();
        // Draining clears the slot, so the intent cannot fire a second time on
        // the next transition that completes.
        expect(routeNames(probe)).toEqual(['home', 'settings', 'profile']);

        act(() => { probe.nav!.pop(); });
        await settled();
        expect(routeNames(probe)).toEqual(['home', 'settings']);
    });

    it('drops a queued intent that has aged past the replay window', async () => {
        const probe = mount();

        act(() => { probe.nav!.push('settings'); });
        act(() => { probe.nav!.push('profile', { id: '7' }, { tab: 'posts' }); });

        // Age the queued intent past QUEUED_INTENT_MAX_AGE_MS. The suite runs
        // on fake timers, and simply advancing the clock would also complete
        // the transition — so the skew is applied to `Date.now` alone, leaving
        // the timer queue to drain normally in `settled()` below.
        const realNow = Date.now;
        const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow.call(Date) + 5000);
        try {
            await settled();
        } finally {
            spy.mockRestore();
        }

        expect(routeNames(probe)).toEqual(['home', 'settings']);
    });

    it('still replays when params cannot be canonicalized', async () => {
        const probe = mount();

        // A circular bag makes the JSON canonicalization throw. That runs
        // inside the replay microtask, so an unguarded throw would strand the
        // navigation entirely rather than merely misjudge a duplicate.
        const circular: Record<string, unknown> = { id: '7' };
        circular.self = circular;

        act(() => { probe.nav!.push('settings'); });
        act(() => {
            (probe.nav!.push as (n: string, ...a: unknown[]) => void)('profile', circular, { tab: 'posts' });
        });

        await settled();
        expect(routeNames(probe)).toEqual(['home', 'settings', 'profile']);
    });

    it('still replays when params stringify to undefined', async () => {
        const probe = mount();

        // A function stringifies to `undefined` WITHOUT throwing, so it never
        // reaches the catch path. Treating that as "no params" would make this
        // look identical to the plain `push('settings')` already on top, and
        // the replay would be dropped.
        act(() => { probe.nav!.push('settings'); });
        act(() => {
            (probe.nav!.push as (n: string, ...a: unknown[]) => void)('settings', () => {});
        });

        await settled();
        expect(routeNames(probe)).toEqual(['home', 'settings', 'settings']);
    });

    it('does not stack a duplicate when params are identical', async () => {
        const probe = mount();

        // Both sides of the comparison must canonicalize the same way even
        // though the stored entry is read back through the stack signal's
        // proxy while the queued intent holds the raw object.
        act(() => { probe.nav!.push('profile', { id: '7' }, { tab: 'posts' }); });
        act(() => { probe.nav!.push('profile', { id: '7' }, { tab: 'posts' }); });

        await settled();
        expect(routeNames(probe)).toEqual(['home', 'profile']);
    });

    it('discards a queued intent when reset() replaces the stack', async () => {
        const probe = mount();

        act(() => { probe.nav!.push('settings'); });
        // Queued against the outgoing stack…
        act(() => { probe.nav!.push('profile', { id: '7' }, { tab: 'posts' }); });
        // …then the whole stack is replaced wholesale (deep link, restore).
        // `reset` clears the transition too, so without an explicit discard
        // the queued push would drain straight onto the restored stack.
        act(() => {
            probe.nav!.reset({ stack: [probe.nav!.stack[0]] });
        });

        await settled();
        expect(routeNames(probe)).toEqual(['home']);
    });

    it('replays a same-route push that differs by params', async () => {
        const probe = mount();
        act(() => { probe.nav!.push('profile', { id: '1' }, { tab: 'posts' }); });
        await settled();

        // Two rows that both push `profile`, tapped in quick succession: the
        // second must NOT be mistaken for a duplicate of the first.
        act(() => { probe.nav!.push('profile', { id: '1' }, { tab: 'posts' }); });
        act(() => { probe.nav!.push('profile', { id: '2' }, { tab: 'posts' }); });
        await settled();

        const ids = probe.nav!.stack.map((e) => (e.params as { id?: string } | undefined)?.id);
        expect(ids).toEqual([undefined, '1', '1', '2']);
    });
});
