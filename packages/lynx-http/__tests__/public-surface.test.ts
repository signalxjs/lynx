/**
 * Public-surface freeze test for @sigx/lynx-http.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`RequestInitLike`, `BodyInitLike`, `AbortSignalLike`,
 *    `HeadersInitLike`, `FileHandleLike`, `FormDataEntryValueLike`,
 *    `NativeRequestSpec`, …) are erased at runtime and are pinned below.
 *  - Types: the load-bearing signatures. This package is a web-platform
 *    *polyfill*, so its contract is the WHATWG shape rather than the sigx
 *    namespace shape — portable code written against `fetch`/`Headers`/
 *    `FormData`/`Response` has to keep compiling unchanged, and the
 *    availability probe has to stay synchronous (C2).
 *
 * Note: this package has no `.web.ts` sibling — on web the host browser's own
 * `fetch` stays in place (the barrel only gap-fills off-Lynx) — so there is no
 * web-parity block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as http from '../src/index';
import { FormData, Headers, Response, fetch, isFileHandle } from '../src/index';
import type {
    FileHandleLike,
    FormDataEntryValueLike,
    HeadersInitLike,
    RequestInitLike,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(http).sort()).toEqual(
            [
                // WHATWG networking surface — the reason the package exists
                'fetch',
                'Headers',
                'FormData',
                'Response',
                'BodyStream',
                'TextDecoder',
                // Availability probe + the FormData value guard
                'isHttpAvailable',
                'isFileHandle',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps the availability probe synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true. Frozen as-is, not endorsed: C2 names this
        // `isAvailable`; here it is a bare root export called
        // `isHttpAvailable` because the barrel has no namespace to hang it on
        // and `isAvailable` would collide in a wildcard re-export.
        expectTypeOf(http.isHttpAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(http.isHttpAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins fetch to the WHATWG-compatible call shape', () => {
        // Consumers pass either a URL string or anything URL-shaped, and get a
        // Promise of *our* Response. Narrowing the input or resolving to
        // something else would break every portable `fetch(url)` call site.
        expectTypeOf(fetch).toEqualTypeOf<
            (input: string | { url: string }, init?: RequestInitLike) => Promise<Response>
        >();
        // Non-standard but load-bearing for upload UIs: the progress hook has
        // to stay optional so plain `RequestInit` literals still assign.
        expectTypeOf<RequestInitLike['onUploadProgress']>().toEqualTypeOf<
            ((loaded: number, total: number) => void) | undefined
        >();
    });

    it('pins the Response body accessors', () => {
        // `json()` deliberately resolves `unknown`, not `any` — a consumer that
        // stopped having to narrow would silently lose type safety.
        expectTypeOf<Response['json']>().toEqualTypeOf<() => Promise<unknown>>();
        expectTypeOf<Response['text']>().toEqualTypeOf<() => Promise<string>>();
        expectTypeOf<Response['arrayBuffer']>().toEqualTypeOf<() => Promise<ArrayBuffer>>();
        // `ok` / `bodyUsed` are getters, not methods; code branches on them
        // directly (`if (!res.ok)`).
        expectTypeOf<Response['ok']>().toEqualTypeOf<boolean>();
        expectTypeOf<Response['bodyUsed']>().toEqualTypeOf<boolean>();
    });

    it('keeps Headers.get nullable', () => {
        // WHATWG returns `null` for a missing header; widening to `string`
        // would make `res.headers.get('x') ?? fallback` look dead to the
        // compiler at every call site.
        expectTypeOf<Headers['get']>().toEqualTypeOf<(name: string) => string | null>();
        expectTypeOf<Headers['has']>().toEqualTypeOf<(name: string) => boolean>();
        // The init union is what makes `new Headers(res.headers)` and
        // `new Headers({ 'content-type': … })` both legal; dropping the
        // iterable arm would break entry-array call sites.
        expectTypeOf<HeadersInitLike>().toEqualTypeOf<
            Headers | Record<string, string> | Iterable<readonly [string, string]>
        >();
    });

    it('pins the FormData entry contract and its guard', () => {
        // Multipart upload is the package's headline feature: entries are
        // strings or file handles (never Blob — Lynx has no Blob), and
        // `isFileHandle` is the narrowing consumers use to tell them apart.
        expectTypeOf<FormDataEntryValueLike>().toEqualTypeOf<string | FileHandleLike>();
        expectTypeOf<FormData['append']>().toEqualTypeOf<
            (name: string, value: FormDataEntryValueLike, filename?: string) => void
        >();
        expectTypeOf(isFileHandle).toEqualTypeOf<(value: unknown) => value is FileHandleLike>();
    });
});
