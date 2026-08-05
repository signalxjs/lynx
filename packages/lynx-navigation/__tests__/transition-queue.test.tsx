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
import { describe, expect, it } from 'vitest';
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

/** Longer than settle + slide + landing ack, so the transition has cleared. */
const AFTER_TRANSITION_MS = 900;
const settled = (): Promise<void> =>
    new Promise((resolve) => { setTimeout(resolve, AFTER_TRANSITION_MS); });

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

    it('drops a queued intent once it has gone stale', async () => {
        const probe = mount();

        act(() => { probe.nav!.push('settings'); });
        act(() => { probe.nav!.push('profile', { id: '7' }, { tab: 'posts' }); });
        await settled();
        // Replayed exactly once — draining clears the slot, so the intent
        // cannot fire again on the next transition that completes.
        expect(routeNames(probe)).toEqual(['home', 'settings', 'profile']);

        act(() => { probe.nav!.pop(); });
        await settled();
        expect(routeNames(probe)).toEqual(['home', 'settings']);
    });
});
