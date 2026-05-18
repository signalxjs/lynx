/**
 * `useScreenChrome` tests.
 *
 * Pins down the transition-aware + scope-aware resolution rules that
 * make a Stack-slot header behave correctly while preserving per-screen
 * (inside-the-body) pins:
 *
 *  - **Push transition:** chrome reads the new top (`transition.topEntry`).
 *  - **Pop transition:** chrome reads the *underneath* entry, not the
 *    entry being animated off (which is still nav.current until the
 *    animation completes).
 *  - **Stack chrome slot with an outer EntryScope:** the slot lives
 *    outside its own EntryScope but inherits the outer one. The chrome
 *    must ignore that pin (it belongs to a different nav) and fall
 *    through to destination logic.
 *  - **Inside-body header:** when the EntryScope's entry is on the
 *    resolved nav's stack (modal-on-root, screen-in-stack), pin to that
 *    entry so the chrome slides with the screen during transitions.
 *  - **Soft useCurrentEntry:** the hook reads via `useCurrentEntryOptional`
 *    and degrades to destination logic when called outside any
 *    EntryScope — no thrown error reaches the caller.
 *
 * The transition tests inject a synthetic Nav + Internals via
 * `defineProvide` so they're deterministic — the real navigator's
 * `animateProgress` uses real `setTimeout`, which makes a "during a
 * pop" assertion racy in jsdom.
 */
import { describe, expect, it } from 'vitest';
import { component, defineProvide, useSharedValue } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { Screen } from '../src/components/Screen';
import { useNav, type Nav } from '../src/hooks/use-nav';
import { useNavInternals, type NavInternals } from '../src/hooks/use-nav-internal';
import { useScreenChrome, type ScreenChrome } from '../src/hooks/use-screen-chrome';
import { createScreenRegistry } from '../src/internal/screen-registry';
import type { StackEntry, TransitionState } from '../src/types';
import { routes } from './_fixtures';

type ChromeProbe = { chrome: ScreenChrome | null; nav: Nav | null };

const ChromeCapture = component<{ probe: ChromeProbe } & {}>(({ props }) => {
    const chrome = useScreenChrome();
    const nav = useNav();
    props.probe.chrome = chrome;
    props.probe.nav = nav;
    return () => null;
});

// ---------------------------------------------------------------------------
// Synthetic nav: lets us pin the transition state from the test without
// going through the navigator's real animation pipeline.
// ---------------------------------------------------------------------------

interface SyntheticEnv {
    nav: Nav;
    internals: NavInternals;
    register(entry: StackEntry, options: { title?: string }): void;
}

function makeSynthetic(initialStack: StackEntry[]): SyntheticEnv {
    let stack = [...initialStack];
    let transition: TransitionState | null = null;
    const screensMap = new Map<string, ReturnType<typeof createScreenRegistry>>();

    const nav: Nav = {
        get current() { return stack[stack.length - 1]; },
        get stack() { return stack; },
        get canGoBack() { return stack.length > 1; },
        get transition() { return transition; },
        get isLocallyFocused() { return true; },
        get parent() { return null; },
        _children: new Set(),
        push: () => {},
        replace: () => {},
        pop: () => {
            if (stack.length > 1) stack = stack.slice(0, -1);
        },
        popN: () => {},
        popTo: () => {},
        popToRoot: () => {},
        reset: () => {},
        dismiss: () => {},
    } as unknown as Nav;

    // The test sets `transition` via direct assignment from outside this
    // closure (see `setSyntheticTransition` below), which keeps the hook
    // path pure (it goes through nav.transition like in prod).
    Object.defineProperty(nav, '_setTransition', {
        value: (t: TransitionState | null) => { transition = t; },
        enumerable: false,
    });

    const internals: NavInternals = {
        progress: null,
        beginBackGesture: () => {},
        commitBackGesture: () => {},
        cancelBackGesture: () => {},
        edgeSwipeEnabled: false,
        screens: {
            register: (reg) => { screensMap.set(reg.entry.key, reg); },
            unregister: (reg) => {
                if (screensMap.get(reg.entry.key) === reg) {
                    screensMap.delete(reg.entry.key);
                }
            },
            get: (key) => screensMap.get(key),
        },
    };

    return {
        nav,
        internals,
        register(entry, options) {
            const reg = createScreenRegistry(entry);
            if (options.title !== undefined) reg.options.title = options.title;
            screensMap.set(entry.key, reg);
        },
    };
}

function setSyntheticTransition(nav: Nav, t: TransitionState | null): void {
    (nav as unknown as { _setTransition: (t: TransitionState | null) => void })
        ._setTransition(t);
}

const ChromeUnderFakeNav = component<{
    probe: ChromeProbe;
    env: SyntheticEnv;
} & {}>(({ props }) => {
    defineProvide(useNav, () => props.env.nav);
    defineProvide(useNavInternals, () => props.env.internals);
    return () => <ChromeCapture probe={props.probe} />;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useScreenChrome destination-entry resolution', () => {
    it('returns the new top during a push transition', () => {
        const home: StackEntry = {
            key: 'home-1', route: 'home', params: {}, search: {},
            state: undefined, presentation: 'card',
        };
        const settings: StackEntry = {
            key: 'settings-1', route: 'settings', params: {}, search: {},
            state: undefined, presentation: 'card',
        };
        const env = makeSynthetic([home, settings]);
        env.register(home, { title: 'Home' });
        env.register(settings, { title: 'Settings' });
        const probe: ChromeProbe = { chrome: null, nav: null };

        const tree = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <ChromeUnderFakeNav probe={probe} env={env} />
            </NavigationRoot>,
        );

        // Mid-push: stack already has settings on top, transition.kind='push'.
        setSyntheticTransition(env.nav, {
            kind: 'push',
            topEntry: settings,
            underneathEntry: home,
            progress: useSharedValue(0) as unknown as TransitionState['progress'],
        });

        expect(probe.chrome!.title).toBe('Settings');
        expect(probe.chrome!.canGoBack).toBe(true);
        tree.unmount();
    });

    it('returns the underneath entry during a pop transition (no end-of-animation lag)', () => {
        const home: StackEntry = {
            key: 'home-1', route: 'home', params: {}, search: {},
            state: undefined, presentation: 'card',
        };
        const settings: StackEntry = {
            key: 'settings-1', route: 'settings', params: {}, search: {},
            state: undefined, presentation: 'card',
        };
        // During an animated pop, the popping entry is still in the
        // stack and `nav.current` is still that entry. The chrome must
        // read `transition.underneathEntry` (home) instead.
        const env = makeSynthetic([home, settings]);
        env.register(home, { title: 'Home' });
        env.register(settings, { title: 'Settings' });
        const probe: ChromeProbe = { chrome: null, nav: null };

        const tree = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <ChromeUnderFakeNav probe={probe} env={env} />
            </NavigationRoot>,
        );

        setSyntheticTransition(env.nav, {
            kind: 'pop',
            topEntry: settings,         // animating off
            underneathEntry: home,      // the destination
            progress: useSharedValue(0) as unknown as TransitionState['progress'],
        });

        expect(probe.chrome!.title).toBe('Home');
        expect(probe.chrome!.canGoBack).toBe(false);
        tree.unmount();
    });

    it('falls through to nav.current when no transition is active', () => {
        const home: StackEntry = {
            key: 'home-1', route: 'home', params: {}, search: {},
            state: undefined, presentation: 'card',
        };
        const env = makeSynthetic([home]);
        env.register(home, { title: 'Home' });
        const probe: ChromeProbe = { chrome: null, nav: null };

        const tree = render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <ChromeUnderFakeNav probe={probe} env={env} />
            </NavigationRoot>,
        );

        // No transition set — should read nav.current.
        expect(probe.chrome!.title).toBe('Home');
        expect(probe.chrome!.canGoBack).toBe(false);
        tree.unmount();
    });
});

describe('useScreenChrome scope handling', () => {
    it('a chrome slot ignores an outer EntryScope from a different nav', () => {
        // Real-world scenario: outer Stack with the outer entry's body
        // containing a nested `<Stack initialRoute=…>`. ChromeCapture
        // is the inner Stack's chrome slot — it lives inside the outer
        // EntryScope but outside the inner Stack's EntryScope. Its
        // `useNav()` resolves to the inner stack's nav; its
        // `useCurrentEntryOptional()` returns the outer entry (from
        // the outer scope). Outer entry is NOT on the inner nav's
        // stack — chrome must ignore the pin and read inner nav's
        // current.
        //
        // Routes reused from the fixture (home as the outer route
        // that hosts the inner Stack; settings as the inner Stack's
        // initial route) so we don't have to extend the global
        // Register augmentation.
        const probe: ChromeProbe = { chrome: null, nav: null };
        const Inner = component(() => () => (
            <Screen title="Inner"><view /></Screen>
        ));
        const Outer = component(() => () => (
            <Stack initialRoute="settings">
                <ChromeCapture probe={probe} />
            </Stack>
        ));
        const localRoutes = {
            ...routes,
            home: { component: Outer },
            settings: { component: Inner },
        } as typeof routes;
        const tree = render(
            <NavigationRoot routes={localRoutes} initialRoute="home" animated={false}>
                <Stack />
            </NavigationRoot>,
        );

        expect(probe.nav!.current.route).toBe('settings');
        expect(probe.chrome!.title).toBe('Inner');
        tree.unmount();
    });
});

describe('useScreenChrome soft-fallback when out of scope', () => {
    it('does not throw when called outside any EntryScope', () => {
        const probe: ChromeProbe = { chrome: null, nav: null };
        expect(() =>
            render(
                <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                    <ChromeCapture probe={probe} />
                </NavigationRoot>,
            ),
        ).not.toThrow();
        // And it falls through to nav.current (route-name fallback,
        // since no `<Screen>` ran to set a title).
        expect(probe.chrome!.title).toBe('home');
    });
});
