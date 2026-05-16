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
import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { useNav } from '../src/hooks/use-nav.js';
import { useIsFocused, useFocusEffect } from '../src/hooks/use-focus.js';
import { NavigationRoot } from '../src/components/NavigationRoot.js';
import { Stack } from '../src/components/Stack.js';
import { routes } from './_fixtures.js';

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

        // Push settings on top: home's screen is unmounted by `<Stack>`'s
        // idle render (which only mounts the top entry). Unmount path runs
        // home's cleanup. Settings mounts, sees itself focused, runs its cb.
        act(() => {
            probe.nav!.push('settings');
        });
        expect(events).toEqual([
            'home:focus',
            'home:blur',
            'settings:focus',
        ]);

        // Pop back: settings unmounts (cleanup), home re-mounts (focus).
        act(() => {
            probe.nav!.pop();
        });
        expect(events).toEqual([
            'home:focus',
            'home:blur',
            'settings:focus',
            'settings:blur',
            'home:focus',
        ]);

        result.unmount();
        // Unmounting the root should run home's pending cleanup.
        expect(events).toEqual([
            'home:focus',
            'home:blur',
            'settings:focus',
            'settings:blur',
            'home:focus',
            'home:blur',
        ]);
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
