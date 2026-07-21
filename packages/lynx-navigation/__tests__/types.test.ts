/**
 * Type-spike acceptance tests for @sigx/lynx-navigation.
 *
 * These tests exercise the type machinery only — runtime is stubbed and
 * intentionally throws. We use:
 *   - `expectTypeOf` (from vitest) for positive assertions.
 *   - `// @ts-expect-error` markers wrapped in unreachable code for negative
 *     assertions (lines TS must reject).
 *
 * Wrapping negatives in `if (false) {...}` keeps the test runtime clean while
 * still forcing TS to evaluate the expression at type-check time.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { hrefFor, parseHref, type Href } from '../src/href';
import { useNav } from '../src/hooks/use-nav';
import { useParams } from '../src/hooks/use-params';
import { useSearch } from '../src/hooks/use-search';
// Side-effect import: the shared fixtures file augments `Register.routes`
// for the whole test suite. types.test.ts and runtime.test.tsx must share a
// single augmentation (TS forbids two `interface Register` declarations with
// different shapes), so route fixtures live in `_fixtures.tsx`.
import './_fixtures';

// ---------------------------------------------------------------------------
// useNav — push / replace
// ---------------------------------------------------------------------------

describe('useNav.push — typed route names', () => {
    it('accepts a registered route name', () => {
        // We never actually call useNav() (it throws), but we can pull its type
        // off the function signature for static checks.
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        expectTypeOf(nav.push).toBeCallableWith('home');
        expectTypeOf(nav.push).toBeCallableWith('profile', { id: '42' });
        expectTypeOf(nav.push).toBeCallableWith(
            'profile',
            { id: '42' },
            { tab: 'about' },
        );
    });

    it('rejects unknown route names', () => {
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        if (false as boolean) {
            // @ts-expect-error — 'porfile' is not a registered route name
            nav.push('porfile', { id: '42' });
            void nav;
        }
    });

    it('requires params when route declares a params schema', () => {
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        if (false as boolean) {
            // @ts-expect-error — 'profile' requires `{ id: string }`
            nav.push('profile');
            void nav;
        }
    });

    it('rejects wrong-typed params', () => {
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        if (false as boolean) {
            // @ts-expect-error — id must be a string
            nav.push('profile', { id: 42 });
            void nav;
        }
    });

    it('rejects extra keys on params', () => {
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        if (false as boolean) {
            // @ts-expect-error — `extra` is not in the schema
            nav.push('profile', { id: '42', extra: 'nope' });
            void nav;
        }
    });

    it('rejects params on a route with no params schema', () => {
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        if (false as boolean) {
            // @ts-expect-error — `home` accepts no params
            nav.push('home', { id: '42' });
            void nav;
        }
    });

    it('rejects wrong-shaped search', () => {
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        if (false as boolean) {
            // @ts-expect-error — `tab` must be 'posts' | 'about'
            nav.push('profile', { id: '42' }, { tab: 'unknown' });
            void nav;
        }
    });

    it('replace has the same typing as push', () => {
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        expectTypeOf(nav.replace).toBeCallableWith('home');
        expectTypeOf(nav.replace).toBeCallableWith('profile', { id: '42' });
        if (false as boolean) {
            // @ts-expect-error — same constraints as push
            nav.replace('profile', { id: 42 });
            void nav;
        }
    });

    it('popTo accepts only registered route names', () => {
        type Nav = ReturnType<typeof useNav>;
        const nav = {} as Nav;
        expectTypeOf(nav.popTo).toBeCallableWith('home');
        if (false as boolean) {
            // @ts-expect-error — unknown route
            nav.popTo('porfile');
            void nav;
        }
    });
});

// ---------------------------------------------------------------------------
// useParams / useSearch
// ---------------------------------------------------------------------------

describe('useParams — typed return', () => {
    it('returns the route\'s params shape', () => {
        expectTypeOf(useParams<'profile'>).returns.toEqualTypeOf<{ id: string }>();
    });

    it('returns Record<string, never> for routes without params schema', () => {
        expectTypeOf(useParams<'home'>).returns.toEqualTypeOf<Record<string, never>>();
    });

    it('rejects unknown route names', () => {
        if (false as boolean) {
            // @ts-expect-error — unknown route
            useParams('porfile');
        }
    });
});

describe('useSearch — typed return', () => {
    it('returns the route\'s search shape', () => {
        expectTypeOf(useSearch<'profile'>).returns.toEqualTypeOf<{
            tab: 'posts' | 'about';
        }>();
    });

    it('returns Record<string, never> for routes without search schema', () => {
        expectTypeOf(useSearch<'home'>).returns.toEqualTypeOf<Record<string, never>>();
    });
});

// ---------------------------------------------------------------------------
// hrefFor / parseHref
// ---------------------------------------------------------------------------

describe('hrefFor — typed builder', () => {
    it('accepts registered routes with correct params', () => {
        expectTypeOf(hrefFor).toBeCallableWith('home');
        expectTypeOf(hrefFor).toBeCallableWith('profile', { id: '42' });
        expectTypeOf(hrefFor).toBeCallableWith(
            'profile',
            { id: '42' },
            { tab: 'posts' },
        );
    });

    it('rejects wrong-shaped params', () => {
        if (false as boolean) {
            // @ts-expect-error — id must be a string
            hrefFor('profile', { id: 42 });
        }
    });

    it('rejects routes that require params when called without them', () => {
        if (false as boolean) {
            // @ts-expect-error — profile requires { id: string }
            hrefFor('profile');
        }
    });

    it('parseHref returns a generic Href or null', () => {
        expectTypeOf(parseHref).returns.toEqualTypeOf<Href | null>();
    });
});

// ---------------------------------------------------------------------------
// Sanity: Register augmentation propagates to RouteId
// ---------------------------------------------------------------------------

describe('Register augmentation', () => {
    it('exposes the registered route names as a literal union via RouteId', async () => {
        // RouteId is the canonical "all registered route names" type — used by
        // every other API. Asserting on it covers the augmentation path more
        // robustly than reflecting through Parameters<Nav['push']>, which only
        // sees the last overload.
        const { type: _type } = (await import('../src/register.js')) as never;
        type Mod = typeof import('../src/register.js');
        type RouteIdT = Mod['RouteId' & keyof Mod] extends infer R ? R : never;
        // The above import-typeof dance keeps the type ref alive even though
        // the runtime import is `as never` — vitest only needs the runtime
        // import to count this as a test file.
        void _type;
        // Direct check against RouteId via re-export:
        type DirectRouteId = import('../src/register.js').RouteId;
        expectTypeOf<DirectRouteId>().toEqualTypeOf<
            'home' | 'profile' | 'settings' | 'composeMessage' | 'filterSheet' | 'grabberSheet' | 'panelSheet'
        >();
        void ({} as RouteIdT);
    });
});
