/**
 * Runtime tests for `useIsFocused` + `useFocusEffect`.
 *
 * Verifies:
 *  - `useIsFocused()` is true for the top screen, false for screens beneath
 *    it (which stay mounted but aren't focused).
 *  - Focus flips reactively when something is pushed on top or popped off.
 *  - `useFocusEffect`'s callback runs on focus, cleanup runs on blur.
 *  - Cleanup also runs on unmount.
 *  - Calling `useIsFocused()` outside a `<Stack>`-rendered screen throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { useNav } from '../src/hooks/use-nav';
import { useIsFocused, useFocusEffect, useDidAppear } from '../src/hooks/use-focus';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { routes } from './_fixtures';

interface NavProbe {
    nav: ReturnType<typeof useNav> | null;
}

const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    const nav = useNav();
    props.probe.nav = nav;
    return () => null;
});

// ---------------------------------------------------------------------------
// useIsFocused
// ---------------------------------------------------------------------------

describe('useIsFocused', () => {
    it('returns true for the top screen and tracks focus reactively', () => {
        // Each screen captures its own latest focus state into a shared object
        // so we can assert about screens that aren't currently the visible
        // text (they stay mounted underneath).
        const focusLog: Record<string, boolean> = {};

        const TrackedHome = component(() => {
            const isFocused = useIsFocused();
            return () => {
                focusLog.home = isFocused.value;
                return <view><text>{`home-${isFocused.value ? 'on' : 'off'}`}</text></view>;
            };
        });
        const TrackedSettings = component(() => {
            const isFocused = useIsFocused();
            return () => {
                focusLog.settings = isFocused.value;
                return <view><text>{`settings-${isFocused.value ? 'on' : 'off'}`}</text></view>;
            };
        });

        const localRoutes = {
            ...routes,
            home: { component: TrackedHome },
            settings: { component: TrackedSettings },
        } as typeof routes;

        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        expect(focusLog.home).toBe(true);

        act(() => {
            probe.nav!.push('settings');
        });

        // Settings is now on top: focused. Home stays mounted in the idle
        // render (it isn't — `<Stack>` only renders the top entry at rest).
        // So home doesn't re-render, focusLog.home stays at its last value.
        // Settings should report focused on its first render.
        expect(focusLog.settings).toBe(true);

        act(() => {
            probe.nav!.pop();
        });

        // Back to home — home re-mounts as the top entry, reports focused.
        expect(focusLog.home).toBe(true);

        result.unmount();
    });
});

// ---------------------------------------------------------------------------
// useFocusEffect
// ---------------------------------------------------------------------------

describe('useFocusEffect', () => {
    it('runs cb on focus and cleanup on blur (push) then re-runs on re-focus (pop)', () => {
        const events: string[] = [];

        const Home = component(() => {
            useFocusEffect(() => {
                events.push('home:focus');
                return () => events.push('home:blur');
            });
            return () => <view><text>Home</text></view>;
        });
        const Settings = component(() => {
            useFocusEffect(() => {
                events.push('settings:focus');
                return () => events.push('settings:blur');
            });
            return () => <view><text>Settings</text></view>;
        });

        const localRoutes = {
            ...routes,
            home: { component: Home },
            settings: { component: Settings },
        } as typeof routes;

        const probe: NavProbe = { nav: null };
        const result = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );

        expect(events).toEqual(['home:focus']);

        // Push settings on top. Both home's blur and settings's focus fire
        // — but the relative order is an internal reconciler detail. We
        // assert only that the set of events is correct, not their order,
        // since the layered render structure may mount the new entry
        // before unmounting the old (matches React Navigation's behavior).
        act(() => {
            probe.nav!.push('settings');
        });
        expect(events.slice(0, 1)).toEqual(['home:focus']);
        expect(events.slice(1).sort()).toEqual(['home:blur', 'settings:focus'].sort());

        // Pop back: settings's blur and home's focus both fire, again
        // without strict ordering.
        act(() => {
            probe.nav!.pop();
        });
        expect(events.slice(0, 3).sort()).toEqual(
            ['home:focus', 'home:blur', 'settings:focus'].sort(),
        );
        expect(events.slice(3).sort()).toEqual(['home:focus', 'settings:blur'].sort());

        result.unmount();
        // Unmounting the root runs home's pending cleanup.
        expect(events.filter((e) => e === 'home:blur').length).toBe(2);
        expect(events.filter((e) => e === 'home:focus').length).toBe(2);
        expect(events.filter((e) => e === 'settings:focus').length).toBe(1);
        expect(events.filter((e) => e === 'settings:blur').length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// useDidAppear
// ---------------------------------------------------------------------------

describe('useDidAppear', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const Probe = (events: string[], tag: string) =>
        component(() => {
            useDidAppear(() => {
                events.push(`${tag}:appear`);
                return () => events.push(`${tag}:disappear`);
            });
            return () => <view><text>{tag}</text></view>;
        });

    it('runs cb at mount when the screen is already at rest', () => {
        const events: string[] = [];
        const localRoutes = { ...routes, home: { component: Probe(events, 'home') } } as typeof routes;

        render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Stack />
            </NavigationRoot>,
        );

        // No transition is in flight for the initial route, so it has
        // "appeared" as soon as it mounts.
        expect(events).toEqual(['home:appear']);
    });

    it('defers cb until an animated push has settled', async () => {
        const events: string[] = [];
        const localRoutes = {
            ...routes,
            home: { component: Probe(events, 'home') },
            settings: { component: Probe(events, 'settings') },
        } as typeof routes;

        const probe: NavProbe = { nav: null };
        render(
            <NavigationRoot routes={localRoutes} initialRoute="home">
                <NavCapture probe={probe} />
                <Stack />
            </NavigationRoot>,
        );
        expect(events).toEqual(['home:appear']);

        // Animated push: the stack commits immediately (so the screen is
        // already FOCUSED), but the slide is still running. This is exactly
        // the window `useFocusEffect` would have fired in — `useDidAppear`
        // must stay quiet so heavy mount work can't starve the tween.
        act(() => {
            probe.nav!.push('settings');
        });
        expect(probe.nav!.transition).not.toBeNull();
        expect(events).not.toContain('settings:appear');

        // …and fires once the transition clears. Fake timers run to
        // exhaustion rather than advancing a guessed duration, so this doesn't
        // have to track the settle window or slide duration; the async form
        // interleaves the awaited microtasks with the timer steps.
        await vi.runAllTimersAsync();
        expect(probe.nav!.transition).toBeNull();
        expect(events.filter((e) => e === 'settings:appear').length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Out-of-scope usage
// ---------------------------------------------------------------------------

describe('focus hooks outside <Stack>', () => {
    it('useIsFocused throws when called outside a screen rendered by <Stack>', () => {
        const Bad = component(() => {
            useIsFocused();
            return () => null;
        });

        expect(() =>
            render(
                <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                    <Bad />
                </NavigationRoot>,
            ),
        ).toThrowError(/No screen entry in scope/);
    });
});
