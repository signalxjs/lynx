/**
 * URL bridge — runtime tests.
 *
 * Covers compile, format, parse, and the end-to-end hrefFor / parseHref API.
 * Uses the shared route fixtures (which include a `path: '/users/:id'` profile
 * route) plus inline ad-hoc compilePath calls for the lower-level checks.
 *
 * Schema validation is exercised through a Zod-shaped fakeSchema that adds a
 * real `validate` function — the test fixture's bare schemas use passthrough.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hrefFor, parseHref } from '../src/href';
import { compilePath } from '../src/url/compile';
import { formatSearch, parseSearch } from '../src/url/format';
import { validateSync } from '../src/url/validate';
import {
    _clearRouteRegistry,
    _setRouteRegistry,
} from '../src/url/registry';
import { defineRoutes } from '../src/define-routes';
import type { StandardSchemaV1 } from '../src/types';
import { Home, Profile, Settings, routes } from './_fixtures';

// ---------------------------------------------------------------------------
// compilePath
// ---------------------------------------------------------------------------

describe('compilePath', () => {
    it('compiles a literal-only path', () => {
        const c = compilePath('/about');
        expect(c.paramNames).toEqual([]);
        expect(c.regex.test('/about')).toBe(true);
        expect(c.regex.test('/about/')).toBe(true);
        expect(c.regex.test('/about/extra')).toBe(false);
        expect(c.format({})).toBe('/about');
    });

    it('compiles a single-param path', () => {
        const c = compilePath('/users/:id');
        expect(c.paramNames).toEqual(['id']);
        const m = c.regex.exec('/users/42');
        expect(m?.[1]).toBe('42');
        expect(c.format({ id: '42' })).toBe('/users/42');
        expect(c.format({ id: 42 })).toBe('/users/42');
    });

    it('compiles a multi-param path', () => {
        const c = compilePath('/users/:userId/posts/:postId');
        expect(c.paramNames).toEqual(['userId', 'postId']);
        const m = c.regex.exec('/users/u1/posts/p2');
        expect(m?.[1]).toBe('u1');
        expect(m?.[2]).toBe('p2');
        expect(c.format({ userId: 'u1', postId: 'p2' })).toBe('/users/u1/posts/p2');
    });

    it('encodes special characters in formatted params', () => {
        const c = compilePath('/users/:id');
        expect(c.format({ id: 'a b/c' })).toBe('/users/a%20b%2Fc');
    });

    it('does not match a non-matching pathname', () => {
        const c = compilePath('/users/:id');
        expect(c.regex.test('/posts/42')).toBe(false);
        expect(c.regex.test('/users')).toBe(false);
        expect(c.regex.test('/users/42/extra')).toBe(false);
    });

    it('escapes regex-special chars in literal segments', () => {
        const c = compilePath('/v1.0/users/:id');
        // The dot must match literally, not `.` regex meaning.
        expect(c.regex.test('/v1.0/users/42')).toBe(true);
        expect(c.regex.test('/v1X0/users/42')).toBe(false);
    });

    it('throws on duplicate param names', () => {
        expect(() => compilePath('/users/:id/extra/:id')).toThrow(/duplicate/);
    });

    it('throws on empty template', () => {
        expect(() => compilePath('')).toThrow();
    });

    it('throws when formatting with a missing param', () => {
        const c = compilePath('/users/:id');
        expect(() => c.format({})).toThrow(/missing required param ':id'/);
    });

    it('normalizes paths without a leading slash', () => {
        const c = compilePath('users/:id');
        expect(c.format({ id: '42' })).toBe('/users/42');
        expect(c.regex.test('/users/42')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// formatSearch / parseSearch
// ---------------------------------------------------------------------------

describe('formatSearch / parseSearch', () => {
    it('round-trips simple key/value pairs', () => {
        const q = formatSearch({ tab: 'about', sort: 'asc' });
        expect(q).toBe('sort=asc&tab=about'); // sorted
        expect(parseSearch(q)).toEqual({ sort: 'asc', tab: 'about' });
    });

    it('returns empty string for empty/undefined input', () => {
        expect(formatSearch(undefined)).toBe('');
        expect(formatSearch({})).toBe('');
    });

    it('skips null/undefined values', () => {
        expect(formatSearch({ a: 'x', b: undefined, c: null })).toBe('a=x');
    });

    it('encodes special chars', () => {
        expect(formatSearch({ q: 'a b&c' })).toBe('q=a%20b%26c');
        expect(parseSearch('q=a%20b%26c')).toEqual({ q: 'a b&c' });
    });

    it('decodes `+` as space (form-encoding convention)', () => {
        expect(parseSearch('q=a+b')).toEqual({ q: 'a b' });
    });

    it('handles repeated keys as arrays', () => {
        expect(parseSearch('t=a&t=b&t=c')).toEqual({ t: ['a', 'b', 'c'] });
    });

    it('emits arrays as repeated keys', () => {
        const q = formatSearch({ t: ['a', 'b'] });
        expect(q).toBe('t=a&t=b');
    });

    it('serializes numbers/booleans as strings', () => {
        expect(formatSearch({ n: 42, b: true })).toBe('b=true&n=42');
    });

    it('tolerates a leading `?`', () => {
        expect(parseSearch('?a=1&b=2')).toEqual({ a: '1', b: '2' });
    });

    it('handles malformed escapes gracefully', () => {
        // %ZZ is not a valid percent-escape; we fall back to the raw text
        // rather than crashing.
        expect(parseSearch('k=%ZZ')).toEqual({ k: '%ZZ' });
    });
});

// ---------------------------------------------------------------------------
// validateSync
// ---------------------------------------------------------------------------

describe('validateSync', () => {
    /** Build a Zod-shaped sync validator for testing the real path. */
    function zodLike<T>(check: (input: unknown) => T): StandardSchemaV1<T, T> {
        return {
            '~standard': {
                version: 1,
                vendor: 'test',
                // Cast through unknown because our minimal StandardSchemaV1
                // type omits `validate` for fixture-ergonomic reasons.
                validate: (input: unknown) => {
                    try {
                        return { value: check(input) };
                    } catch (e) {
                        return {
                            issues: [{ message: (e as Error).message }],
                        };
                    }
                },
                // @ts-ignore — `types` is the phantom; OK to omit-but-cast
                types: undefined,
            },
        } as unknown as StandardSchemaV1<T, T>;
    }

    it('passthroughs when schema is undefined', () => {
        expect(validateSync(undefined, { a: 1 })).toEqual({ ok: true, value: { a: 1 } });
    });

    it('passthroughs when schema lacks validate (test fixtures)', () => {
        const fake = {
            '~standard': { version: 1 as const, vendor: 'x' },
        } as unknown as StandardSchemaV1;
        expect(validateSync(fake, 'hi')).toEqual({ ok: true, value: 'hi' });
    });

    it('returns ok with validated value', () => {
        const s = zodLike<{ id: string }>((v) => {
            const obj = v as { id: unknown };
            if (typeof obj.id !== 'string') throw new Error('id must be string');
            return { id: obj.id };
        });
        expect(validateSync(s, { id: '42' })).toEqual({ ok: true, value: { id: '42' } });
    });

    it('returns issues on validation failure', () => {
        const s = zodLike<{ id: string }>((v) => {
            const obj = v as { id: unknown };
            if (typeof obj.id !== 'string') throw new Error('id must be string');
            return { id: obj.id };
        });
        const result = validateSync(s, { id: 42 });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues).toEqual(['id must be string']);
    });

    it('throws on async validation', () => {
        const s = {
            '~standard': {
                version: 1 as const,
                vendor: 'x',
                validate: () => Promise.resolve({ value: {} }),
            },
        } as unknown as StandardSchemaV1;
        expect(() => validateSync(s, {})).toThrow(/Async schema validation/);
    });
});

// ---------------------------------------------------------------------------
// hrefFor — needs the registry seeded (no NavigationRoot in these tests)
// ---------------------------------------------------------------------------

describe('hrefFor', () => {
    beforeEach(() => {
        _setRouteRegistry(routes);
    });
    afterEach(() => {
        _clearRouteRegistry();
    });

    it('returns null url when the route has no path template', () => {
        const h = hrefFor('home');
        expect(h.route).toBe('home');
        expect(h.params).toEqual({});
        expect(h.search).toEqual({});
        expect(h.url).toBeNull();
    });

    it('returns the formatted url for a route with path + params', () => {
        const h = hrefFor('profile', { id: '42' });
        expect(h.route).toBe('profile');
        expect(h.params).toEqual({ id: '42' });
        expect(h.url).toBe('/users/42');
    });

    it('includes search params in the formatted url', () => {
        const h = hrefFor('profile', { id: '42' }, { tab: 'about' });
        expect(h.url).toBe('/users/42?tab=about');
    });

    it('encodes special chars in params', () => {
        const h = hrefFor('profile', { id: 'a/b c' });
        expect(h.url).toBe('/users/a%2Fb%20c');
    });

    it('throws on an unknown route name', () => {
        expect(() => hrefFor('porfile' as never, { id: '42' } as never))
            .toThrow(/not in the active registry/);
    });

    it('throws when no registry is set', () => {
        _clearRouteRegistry();
        expect(() => hrefFor('home')).toThrow(/No route registry set/);
    });
});

// ---------------------------------------------------------------------------
// parseHref
// ---------------------------------------------------------------------------

describe('parseHref', () => {
    beforeEach(() => {
        _setRouteRegistry(routes);
    });
    afterEach(() => {
        _clearRouteRegistry();
    });

    it('matches a registered path and extracts params', () => {
        const h = parseHref('/users/42');
        expect(h).not.toBeNull();
        expect(h?.route).toBe('profile');
        expect(h?.params).toEqual({ id: '42' });
        expect(h?.search).toEqual({});
    });

    it('preserves the original url string', () => {
        const h = parseHref('/users/42?tab=about');
        expect(h?.url).toBe('/users/42?tab=about');
    });

    it('decodes url-encoded param values', () => {
        const h = parseHref('/users/a%2Fb%20c');
        expect(h?.params).toEqual({ id: 'a/b c' });
    });

    it('extracts search params', () => {
        const h = parseHref('/users/42?tab=about');
        expect(h?.search).toEqual({ tab: 'about' });
    });

    it('returns null on no match', () => {
        expect(parseHref('/nope/123')).toBeNull();
    });

    it('returns null on empty input', () => {
        expect(parseHref('')).toBeNull();
    });

    it('parses absolute URLs with a scheme', () => {
        const h = parseHref('myapp://host/users/42?tab=about');
        expect(h?.route).toBe('profile');
        expect(h?.params).toEqual({ id: '42' });
        expect(h?.search).toEqual({ tab: 'about' });
    });

    it('tolerates a trailing slash on the pathname', () => {
        const h = parseHref('/users/42/');
        expect(h?.route).toBe('profile');
    });

    it('returns null when params fail schema validation', () => {
        // Define a routes map where the profile schema actually rejects.
        const Strict = Profile;
        const strict = defineRoutes({
            home: { component: Home },
            profile: {
                params: {
                    '~standard': {
                        version: 1,
                        vendor: 'test',
                        validate: (v: unknown) => {
                            const obj = v as { id?: unknown };
                            if (typeof obj.id === 'string' && /^\d+$/.test(obj.id)) {
                                return { value: { id: obj.id } };
                            }
                            return { issues: [{ message: 'id must be digits' }] };
                        },
                    },
                } as unknown as StandardSchemaV1<{ id: string }, { id: string }>,
                component: Strict,
                path: '/users/:id',
            },
            settings: { component: Settings },
        });
        _setRouteRegistry(strict);
        expect(parseHref('/users/42')).not.toBeNull();
        // Non-digit id rejected by the schema → parseHref returns null.
        expect(parseHref('/users/abc')).toBeNull();
    });

    it('first registered route wins on overlapping templates', () => {
        const A = Home;
        const overlapping = defineRoutes({
            a: { component: A, path: '/x/:id' },
            b: { component: A, path: '/x/:id' },
        });
        _setRouteRegistry(overlapping);
        expect(parseHref('/x/1')?.route).toBe('a');
    });
});

// ---------------------------------------------------------------------------
// hrefFor → parseHref round-trip
// ---------------------------------------------------------------------------

describe('hrefFor / parseHref round-trip', () => {
    beforeEach(() => {
        _setRouteRegistry(routes);
    });
    afterEach(() => {
        _clearRouteRegistry();
    });

    it('round-trips a route with params + search', () => {
        const built = hrefFor('profile', { id: '42' }, { tab: 'about' });
        expect(built.url).not.toBeNull();
        const parsed = parseHref(built.url!);
        expect(parsed?.route).toBe('profile');
        expect(parsed?.params).toEqual({ id: '42' });
        expect(parsed?.search).toEqual({ tab: 'about' });
    });

    it('round-trips a route with encoded params', () => {
        const built = hrefFor('profile', { id: 'a b/c' });
        const parsed = parseHref(built.url!);
        expect(parsed?.params).toEqual({ id: 'a b/c' });
    });
});
