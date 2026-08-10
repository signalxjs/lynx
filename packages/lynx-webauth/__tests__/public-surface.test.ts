/**
 * Public-surface freeze test for @sigx/lynx-webauth.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect, for both
 *    published entry points — the root barrel and the `./oauth` subpath, which
 *    `package.json#exports` ships separately so the helpers tree-shake away
 *    when unused. Type-only exports (`OpenAuthSessionOptions`,
 *    `OpenAuthSessionResult`, `PkceChallenge`, …) are erased at runtime and
 *    are pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — the availability probe has to stay
 *    synchronous (C2), and the result union has to keep its three arms so a
 *    consumer's `if (result.url) … else if (result.canceled)` stays exhaustive
 *    (C5).
 *
 * Note: this package has no `.web.ts` sibling — a system auth sheet has no web
 * counterpart — so there is no web-parity block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as oauth from '../src/oauth.js';
import type { CallbackParams, PkceChallenge, RandomOptions } from '../src/oauth.js';
import * as webauth from '../src/index.js';
import type { OpenAuthSessionOptions, OpenAuthSessionResult } from '../src/index.js';

describe('public runtime exports', () => {
    it('matches the locked surface of the root entry point', () => {
        expect(Object.keys(webauth).sort()).toEqual(
            [
                'openAuthSession',
                // Frozen as-is, not endorsed: C2 names this probe
                // `isAvailable`. Renaming it is a deliberate surface change
                // owned by the package's audit issue, not by this test.
                'isWebAuthAvailable',
            ].sort(),
        );
    });

    it('matches the locked surface of the ./oauth subpath', () => {
        // A separate published entry point, so it needs its own freeze: an
        // export dropped here is just as breaking as one dropped from the root.
        expect(Object.keys(oauth).sort()).toEqual(
            ['generatePKCE', 'generateState', 'parseCallback', 'sha256'].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps the availability probe synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(webauth.isWebAuthAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(webauth.isWebAuthAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins openAuthSession, including the optional third argument', () => {
        // `options` staying optional is part of the contract — the two-arg call
        // in the README is the common one.
        expectTypeOf(webauth.openAuthSession).toEqualTypeOf<
            (
                authorizeUrl: string,
                callbackScheme: string,
                options?: OpenAuthSessionOptions,
            ) => Promise<OpenAuthSessionResult>
        >();
    });

    it('keeps the result a three-arm union that never rejects (C5)', () => {
        // Every arm declares the other two discriminants as `undefined`, which
        // is what lets `if (result.url) … else if (result.canceled) …` narrow
        // without a `switch` on a tag field. Collapsing the union to a loose
        // `{ url?: string; canceled?: boolean; error?: string }` would compile
        // at the call site and silently stop narrowing.
        expectTypeOf<OpenAuthSessionResult>().toEqualTypeOf<
            | { url: string; canceled?: undefined; error?: undefined }
            | { url?: undefined; canceled: true; error?: undefined }
            | { url?: undefined; canceled?: undefined; error: string }
        >();
        // Frozen as-is, not endorsed: the field is spelled `canceled`
        // (one `l`) while the rest of the repo's cancel-carrying unions use
        // `cancelled`. Aligning it is a breaking rename for consumers.
        expectTypeOf<Extract<OpenAuthSessionResult, { canceled: true }>>().toEqualTypeOf<{
            url?: undefined;
            canceled: true;
            error?: undefined;
        }>();
    });

    it('pins the abort handle on the options bag', () => {
        // `signal` is the only supported way to tear down an in-flight sheet;
        // there is no `cancelAuthSession` export to fall back on.
        expectTypeOf<OpenAuthSessionOptions['signal']>().toEqualTypeOf<AbortSignal | undefined>();
    });

    it('pins the OAuth helpers and their injectable RNG', () => {
        // `randomBytes` is the documented test/no-Web-Crypto seam — losing it
        // makes the helpers unusable in runtimes without `crypto`, and there is
        // deliberately no insecure fallback.
        expectTypeOf(oauth.generatePKCE).toEqualTypeOf<
            (options?: RandomOptions) => Promise<PkceChallenge>
        >();
        expectTypeOf(oauth.generateState).toEqualTypeOf<(options?: RandomOptions) => string>();
        expectTypeOf<RandomOptions['randomBytes']>().toEqualTypeOf<
            ((length: number) => Uint8Array) | undefined
        >();
        // `method` is a literal, not `string`: `plain` PKCE is never emitted,
        // and consumers interpolate this straight into the authorize URL.
        expectTypeOf<PkceChallenge['method']>().toEqualTypeOf<'S256'>();
    });

    it('pins the callback parser as total (params always present)', () => {
        // `params` is non-optional on purpose — a caller reading a
        // provider-specific extra param shouldn't have to null-check the bag.
        expectTypeOf(oauth.parseCallback).toEqualTypeOf<(url: string) => CallbackParams>();
        expectTypeOf<CallbackParams['params']>().toEqualTypeOf<Record<string, string>>();
    });
});
