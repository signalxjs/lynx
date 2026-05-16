/**
 * Unit tests for `@sigx/lynx-linking/nav`.
 *
 * The hook itself (`useLinkingNav`) needs a sigx component context plus a
 * mounted `<NavigationRoot>`, so we don't render it here — the dispatch
 * logic is factored into two pure helpers (`_stripPrefix`, `_navigateToHref`)
 * exported from `../src/nav.js` and unit-tested directly.
 *
 * Cold-start + warm-start integration (mocked `lynx.__globalProps.initialURL`
 * + `GlobalEventEmitter`) belongs in `@sigx/lynx-navigation`'s test suite
 * once the linking-nav integration test is added in a follow-up phase.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Href } from '../src/href.js';
import type { Nav } from '../src/hooks/use-nav.js';
import type { RouteMap } from '../src/types.js';
import { _navigateToHref, _stripPrefix } from '../src/hooks/use-linking-nav.js';

describe('_stripPrefix', () => {
    it('returns the URL unchanged when no prefixes are provided', () => {
        expect(_stripPrefix('myapp://users/42')).toBe('myapp://users/42');
        expect(_stripPrefix('/users/42', [])).toBe('/users/42');
    });

    it('returns the URL unchanged when no prefix matches', () => {
        expect(_stripPrefix('https://other.com/x', ['myapp://'])).toBe('https://other.com/x');
    });

    it('strips a matching scheme prefix and ensures a leading slash', () => {
        expect(_stripPrefix('myapp://users/42', ['myapp://'])).toBe('/users/42');
    });

    it('strips a matching host prefix', () => {
        expect(_stripPrefix('https://myapp.com/users/42', ['https://myapp.com'])).toBe(
            '/users/42',
        );
    });

    it('preserves a query string after stripping', () => {
        expect(_stripPrefix('myapp://users/42?tab=about', ['myapp://'])).toBe(
            '/users/42?tab=about',
        );
    });

    it('returns "/" when the URL is exactly the prefix', () => {
        expect(_stripPrefix('myapp://', ['myapp://'])).toBe('/');
    });

    it('matches the first prefix in order', () => {
        expect(
            _stripPrefix('https://myapp.com/users/42', [
                'myapp://',
                'https://myapp.com',
                'https://',
            ]),
        ).toBe('/users/42');
    });
});

/** Build a minimal Nav stub that records calls; only push/replace matter here. */
function makeNavStub(): {
    nav: Nav;
    pushCalls: unknown[][];
    replaceCalls: unknown[][];
} {
    const pushCalls: unknown[][] = [];
    const replaceCalls: unknown[][] = [];
    const nav = {
        push: vi.fn((...args: unknown[]) => pushCalls.push(args)),
        replace: vi.fn((...args: unknown[]) => replaceCalls.push(args)),
    } as unknown as Nav;
    return { nav, pushCalls, replaceCalls };
}

describe('_navigateToHref', () => {
    const routes: RouteMap = {
        home: { component: (() => null) as unknown as RouteMap[string]['component'] },
        profile: {
            component: (() => null) as unknown as RouteMap[string]['component'],
            params: { '~standard': { version: 1, vendor: 'test' } } as RouteMap[string]['params'],
        },
    };

    it('routes-with-params: calls push(name, params, search)', () => {
        const { nav, pushCalls } = makeNavStub();
        const href = {
            route: 'profile',
            params: { id: '42' },
            search: { tab: 'about' },
            url: '/users/42?tab=about',
        };
        _navigateToHref(nav, routes, href as Href, 'push');
        expect(pushCalls).toEqual([['profile', { id: '42' }, { tab: 'about' }]]);
    });

    it('routes-without-params: calls push(name, search) — params slot skipped', () => {
        const { nav, pushCalls } = makeNavStub();
        const href = {
            route: 'home',
            params: {},
            search: { ref: 'email' },
            url: '/',
        };
        _navigateToHref(nav, routes, href as unknown as Href, 'push');
        // Critical: search must NOT shift into the params slot for no-params
        // routes (else it would land in the options slot at runtime).
        expect(pushCalls).toEqual([['home', { ref: 'email' }]]);
    });

    it('replace kind dispatches to nav.replace, not nav.push', () => {
        const { nav, pushCalls, replaceCalls } = makeNavStub();
        const href = {
            route: 'profile',
            params: { id: '42' },
            search: {},
            url: '/users/42',
        };
        _navigateToHref(nav, routes, href as Href, 'replace');
        expect(pushCalls).toEqual([]);
        expect(replaceCalls).toEqual([['profile', { id: '42' }, {}]]);
    });

    it('bails silently when the route is not in the registry', () => {
        const { nav, pushCalls, replaceCalls } = makeNavStub();
        const href = {
            route: 'unknown',
            params: {},
            search: {},
            url: '/unknown',
        };
        // Should not throw — `parseHref` already validated against the
        // registry; a mismatch here only means the registry changed between
        // parse and dispatch (multi-NavigationRoot edge case).
        expect(() => _navigateToHref(nav, routes, href as unknown as Href, 'push')).not.toThrow();
        expect(pushCalls).toEqual([]);
        expect(replaceCalls).toEqual([]);
    });
});
