/**
 * Benchmarks for @sigx/lynx-navigation.
 *
 * Run with: `npx vitest bench`
 *
 * What we measure:
 *  1. **navigator setup** — `createNavigator(...)` cost. This is what a
 *     `<NavigationRoot>` mount pays once.
 *  2. **push** — single `nav.push` (the cost on the BG thread before MT
 *     starts the slide-in transition).
 *  3. **deep push** — 100 sequential pushes (worst case: deep-link chain
 *     restoring a deep stack on cold start).
 *  4. **pop** — single `nav.pop` from a 50-deep stack.
 *  5. **reset** — `nav.reset` with a 50-entry stack (snapshot restore).
 *  6. **switch-style baseline** — equivalent "what we'd do without a
 *     navigator": a `signal<{ route: string; params: any }>` plus a
 *     setter that mutates it. The navigator should be within ~5x of
 *     this baseline (it does more work — typed dispatch, registered
 *     screen lifecycle, focus events).
 *
 * The hard target from the v1.0 plan is a `nav.push` cost low enough
 * that the MT transition can start within 16ms of the user gesture.
 * On modern hardware vitest reports `nav.push` in microseconds — we're
 * orders of magnitude under that budget — but the bench lives in the
 * suite so regressions surface as numbers, not as "feels slow".
 */
import { bench, describe } from 'vitest';
import { signal } from '@sigx/lynx';
import { createNavigatorState } from '../src/navigator/core.js';
import { routes, Home } from './_fixtures.js';
import type { StackEntry } from '../src/types.js';

void Home;

const initial: StackEntry = { key: 'k0', route: 'home', params: {}, search: {}, state: null, presentation: 'card' };

function makeNav() {
    return createNavigatorState({ routes, initial });
}

describe('navigator setup', () => {
    bench('createNavigatorState()', () => {
        makeNav();
    });
});

describe('push', () => {
    bench('single push', () => {
        const { nav } = makeNav();
        nav.push('profile', { id: 'p1' });
    });

    bench('100 sequential pushes', () => {
        const { nav } = makeNav();
        for (let i = 0; i < 100; i++) {
            if (i % 2 === 0) nav.push('profile', { id: `p${i}` });
            else nav.push('settings');
        }
    });
});

describe('pop', () => {
    bench('single pop from 50-deep stack', () => {
        const { nav } = makeNav();
        for (let i = 0; i < 50; i++) nav.push('profile', { id: `p${i}` });
        nav.pop();
    });
});

describe('reset', () => {
    const entries: StackEntry[] = Array.from({ length: 50 }, (_, i) => ({
        key: `k${i}`,
        route: i % 2 === 0 ? 'profile' : 'settings',
        params: {},
        search: {},
        state: null,
        presentation: 'card',
    }));

    bench('reset to a 50-entry stack', () => {
        const { nav } = makeNav();
        nav.reset({ stack: entries });
    });
});

describe('switch-style baseline (no navigator)', () => {
    // Floor for hand-rolled routing: a single signal carrying
    // `{ route, params }`. The navigator does more (typed dispatch,
    // focus events, screen-registry hooks, MT-side SharedValue plumbing).
    bench('signal-set baseline', () => {
        const state = signal({
            value: { route: 'home', params: {} as Record<string, unknown> },
        });
        state.value = { route: 'profile', params: { id: 'a' } };
    });
});
