/**
 * Tests for the lazy-routes integration:
 *  - `nav.push` calls `.preload()` on lazy components so the chunk fetch
 *    kicks off before render needs the module.
 *  - `nav.replace` likewise preloads.
 *  - Eager components (plain factories, not wrapped in `lazy()`) are left
 *    untouched.
 *
 * We don't render the Defer path in vitest (no MT runtime, fragile);
 * those characteristics are verified in the example app. These tests pin
 * the preload contract — that's the part regressing-easy code (changing
 * `push` internals) would silently break.
 */
import { describe, expect, it, vi } from 'vitest';
import { component, lazy } from '@sigx/lynx';
import { defineRoutes } from '../src/define-routes';
import { createNavigatorState } from '../src/navigator/core';
import type { StackEntry } from '../src/types';

const Eager = component(() => () => null);

function makeLazyRoute() {
    const loadSpy = vi.fn(async () => ({ default: Eager }));
    const LazyComp = lazy(loadSpy);
    return { LazyComp, loadSpy };
}

describe('lazy routes', () => {
    it('push() calls preload() on a lazy route component', async () => {
        const { LazyComp, loadSpy } = makeLazyRoute();
        const routes = defineRoutes({
            home: { component: Eager },
            heavy: { component: LazyComp },
        });
        const initial: StackEntry = {
            key: 'root',
            route: 'home',
            params: {},
            search: {},
            state: undefined,
            presentation: 'card',
        };
        const navState = createNavigatorState({ routes, initial });

        expect(loadSpy).not.toHaveBeenCalled();
        navState.nav.push('heavy' as never);
        // preload schedules an async fetch; the call itself is sync.
        expect(loadSpy).toHaveBeenCalledTimes(1);
        // Let the (already-resolved) promise settle so isLoaded flips.
        await Promise.resolve();
        expect(LazyComp.isLoaded()).toBe(true);
    });

    it('replace() calls preload() on a lazy route component', () => {
        const { LazyComp, loadSpy } = makeLazyRoute();
        const routes = defineRoutes({
            home: { component: Eager },
            heavy: { component: LazyComp },
        });
        const initial: StackEntry = {
            key: 'root',
            route: 'home',
            params: {},
            search: {},
            state: undefined,
            presentation: 'card',
        };
        const navState = createNavigatorState({ routes, initial });

        navState.nav.replace('heavy' as never);
        expect(loadSpy).toHaveBeenCalledTimes(1);
    });

    it('does not call preload for eager components', () => {
        // No lazy() wrapper — must not even attempt to call `.preload()`,
        // and an eager component has no such method.
        const routes = defineRoutes({
            home: { component: Eager },
            settings: { component: Eager },
        });
        const initial: StackEntry = {
            key: 'root',
            route: 'home',
            params: {},
            search: {},
            state: undefined,
            presentation: 'card',
        };
        const navState = createNavigatorState({ routes, initial });

        expect(() => navState.nav.push('settings' as never)).not.toThrow();
    });

    it('preload rejection is swallowed (push still commits)', () => {
        const loadSpy = vi.fn(async () => {
            throw new Error('chunk load failed');
        });
        const LazyComp = lazy(loadSpy);
        const routes = defineRoutes({
            home: { component: Eager },
            heavy: { component: LazyComp },
        });
        const initial: StackEntry = {
            key: 'root',
            route: 'home',
            params: {},
            search: {},
            state: undefined,
            presentation: 'card',
        };
        const navState = createNavigatorState({ routes, initial });

        expect(() => navState.nav.push('heavy' as never)).not.toThrow();
        expect(navState.nav.current.route).toBe('heavy');
    });
});
