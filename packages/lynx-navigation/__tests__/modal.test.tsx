/**
 * Modal presentation tests.
 *
 * Per spec resolved-decisions: a modal is just a Stack entry with
 * `presentation: 'modal' | 'fullScreen' | 'transparent-modal'`. There is no
 * separate `<Modal>` navigator in v1 — the visual treatment (slide-up,
 * transparent backdrop) is the renderer's job; the stack model is uniform.
 *
 * What we lock in here:
 *  - Route-level `presentation: 'modal'` lands on the entry.
 *  - Per-call `options.presentation` overrides the route default.
 *  - `dismiss()` pops back to the nearest non-modal entry.
 *  - `dismiss()` is a no-op when nothing modal-ish is on top.
 */
import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot.js';
import { useNav } from '../src/hooks/use-nav.js';
import type { Nav } from '../src/hooks/use-nav.js';
import { routes } from './_fixtures.js';

// Probe component — captures the Nav at render time so tests can drive it
// without going through any UI affordance.
type NavProbe = { nav: Nav | null };
const NavCapture = component<{ probe: NavProbe } & {}>(({ props }) => {
    const nav = useNav();
    props.probe.nav = nav;
    return () => null;
});

describe('Modal presentation', () => {
    it('marks the entry with route-level `presentation: "modal"`', async () => {
        const probe: NavProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
            </NavigationRoot>,
        );

        act(() =>
            probe.nav!.push('composeMessage', { recipientId: 'u_42' }),
        );

        const top = probe.nav!.current;
        expect(top.route).toBe('composeMessage');
        // composeMessage is declared `presentation: 'modal'` in the fixture —
        // the entry must carry that flag even though we didn't pass options.
        expect(top.presentation).toBe('modal');
    });

    it('per-call options.presentation overrides the route default', async () => {
        const probe: NavProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
            </NavigationRoot>,
        );

        act(() =>
            probe.nav!.push(
                'composeMessage',
                { recipientId: 'u_42' },
                undefined,
                { presentation: 'fullScreen' },
            ),
        );

        expect(probe.nav!.current.presentation).toBe('fullScreen');
    });

    it('push without overriding leaves non-modal routes as "card"', () => {
        const probe: NavProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
            </NavigationRoot>,
        );

        // The initial entry came from `initialRoute: 'home'`, which has no
        // `presentation` declared — default is 'card'.
        expect(probe.nav!.current.presentation).toBe('card');
    });

    it('dismiss() pops back through modals to the nearest card entry', async () => {
        const probe: NavProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
            </NavigationRoot>,
        );

        // home (card) → profile (card) → composeMessage (modal)
        act(() => probe.nav!.push('profile', { id: '7' }));
        act(() =>
            probe.nav!.push('composeMessage', { recipientId: 'u_42' }),
        );
        expect(probe.nav!.stack.length).toBe(3);
        expect(probe.nav!.current.route).toBe('composeMessage');

        act(() => probe.nav!.dismiss());

        // We're back on profile — the modal was the only entry above a card.
        expect(probe.nav!.stack.length).toBe(2);
        expect(probe.nav!.current.route).toBe('profile');
    });

    it('dismiss() collapses a stack of modals back to the underlying card', () => {
        const probe: NavProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
            </NavigationRoot>,
        );

        act(() =>
            probe.nav!.push('composeMessage', { recipientId: 'a' }),
        );
        // A modal-on-modal: pushing another modal-presentation entry on top.
        act(() =>
            probe.nav!.push('composeMessage', { recipientId: 'b' }),
        );
        expect(probe.nav!.stack.length).toBe(3);

        act(() => probe.nav!.dismiss());

        // Both modals dismissed in one call — `dismiss()` finds the nearest
        // 'card' below and slices everything above it off.
        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });

    it('dismiss() is a no-op when no modal is on top', () => {
        const probe: NavProbe = { nav: null };
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <NavCapture probe={probe} />
            </NavigationRoot>,
        );

        act(() => probe.nav!.push('profile', { id: '7' }));
        const before = probe.nav!.stack.length;

        act(() => probe.nav!.dismiss());

        // Nothing modal-flagged on top → dismiss() doesn't touch the stack.
        expect(probe.nav!.stack.length).toBe(before);
        expect(probe.nav!.current.route).toBe('profile');
    });
});
