/**
 * Public-surface freeze test for @sigx/lynx-linking.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Three layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`URLEvent`, `URLListener`, `URLSubscription`,
 *    `BackHandlerSubscription`, `ParsedURL`) are erased at runtime and are
 *    pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous
 *    (C2) and subscriptions have to keep handing back a remover (C7).
 *  - Web parity: the `.web.ts` sibling must expose the same methods, since
 *    the plugin swaps it in by extensionAlias.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as linking from '../src/index';
import { BackHandler, Linking } from '../src/index';
import type { BackHandlerSubscription, ParsedURL, URLListener, URLSubscription } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(linking).sort()).toEqual(
            [
                // Deep links / outbound URLs
                'Linking',
                // Android hardware back button
                'BackHandler',
                // Pure-JS URL helpers (no bridge needed)
                'parse',
                'createURL',
            ].sort(),
        );
    });

    it('exposes exactly the documented Linking methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it — and so does
        // `linking.web.ts`, or the web target silently loses it.
        expect(Object.keys(Linking).sort()).toEqual([
            'addEventListener',
            'canOpenURL',
            'getInitialURL',
            'isAvailable',
            'openURL',
        ]);
    });

    it('exposes exactly the documented BackHandler methods', () => {
        expect(Object.keys(BackHandler).sort()).toEqual(['addEventListener', 'exitApp']);
    });
});

describe('public types', () => {
    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Linking.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Linking.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the outbound bridge signatures', () => {
        // `openURL` / `exitApp` stay `Promise<void>`, but the promise now
        // carries the native failure as a rejection rather than resolving it
        // away (C4) — the behavior behind that is in
        // `__tests__/native-bridge.test.ts`.
        expectTypeOf(Linking.openURL).toEqualTypeOf<(url: string) => Promise<void>>();
        expectTypeOf(Linking.canOpenURL).toEqualTypeOf<(url: string) => Promise<boolean>>();
        expectTypeOf(BackHandler.exitApp).toEqualTypeOf<() => Promise<void>>();
    });

    it('keeps getInitialURL a synchronous nullable read', () => {
        // Reads `__globalProps` directly rather than crossing the bridge, and
        // `null` means "no launch URL" — making it a Promise, or collapsing
        // null to '', would break cold-start deep-link handling at the call
        // site without any type error downstream.
        expectTypeOf(Linking.getInitialURL).toEqualTypeOf<() => string | null>();
    });

    it('hands subscriptions back as a bare unsubscribe function (C7)', () => {
        // Both used to return an RN-style `{ remove() }` object, which is why
        // `lynx-navigation` had to know which shape each call site produced.
        // C7 is a plain `() => void`, idempotent — see
        // `__tests__/subscriptions.test.ts` for the behavior behind the type.
        expectTypeOf(Linking.addEventListener).toEqualTypeOf<
            (type: 'url', listener: URLListener) => URLSubscription
        >();
        expectTypeOf<URLSubscription>().toEqualTypeOf<() => void>();
        expectTypeOf(BackHandler.addEventListener).toEqualTypeOf<
            (listener: () => boolean | void) => BackHandlerSubscription
        >();
        expectTypeOf<BackHandlerSubscription>().toEqualTypeOf<() => void>();
    });

    it('pins the URL-parsing helpers', () => {
        // `parse` is the one export consumers destructure by field name, so
        // the shape is as load-bearing as any signature here.
        expectTypeOf(linking.parse).toEqualTypeOf<(url: string) => ParsedURL>();
        expectTypeOf<ParsedURL>().toEqualTypeOf<{
            scheme: string;
            hostname: string;
            path: string;
            queryParams: Record<string, string>;
        }>();
        expectTypeOf(linking.createURL).toEqualTypeOf<
            (path: string, queryParams?: Record<string, string>) => string
        >();
    });
});

describe('web implementation', () => {
    it('has the same Linking surface as the native one', async () => {
        // The plugin swaps linking.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/linking.web');
        expect(Object.keys(web.Linking).sort()).toEqual(Object.keys(Linking).sort());
    });
});
