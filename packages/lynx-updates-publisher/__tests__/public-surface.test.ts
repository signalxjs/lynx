/**
 * Public-surface freeze test for @sigx/lynx-updates-publisher.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`PublishPlatform`, `PublishUpdateOptions`, `PublishUpdateResult`)
 *    are erased at runtime and are pinned below instead.
 *  - Types: this package's whole value surface is one function, and its weight
 *    sits in the option/result *shapes* — a CI release job destructures
 *    `updateId` / `manifestPath` / `sha256` off the result and feeds
 *    `runtimeVersions` in from elsewhere, so a dropped or retyped field is a
 *    silently broken pipeline, not a compile error at the call site.
 *
 * This is a Node-side library rather than a native module, so the conventions
 * that carry method shapes (C2 `isAvailable`, C6 permissions, C7 unsubscribe,
 * C8 hook suffixes) have nothing to bind to here — there is no namespace object
 * and no runtime capability check. There is also no `.web.ts` sibling, so the
 * web-parity block (D7.1b) is omitted.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as publisher from '../src/index';
import type { PublishPlatform, PublishUpdateOptions, PublishUpdateResult } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(publisher).sort()).toEqual(['publishUpdate']);
    });
});

describe('public types', () => {
    it('pins the entry point signature', () => {
        expectTypeOf(publisher.publishUpdate).toEqualTypeOf<
            (opts: PublishUpdateOptions) => Promise<PublishUpdateResult>
        >();
    });

    it('keeps `cwd` the only required option', () => {
        // The dependency-light CI promise is that `publishUpdate({ cwd })`
        // works off the prebuild sidecar alone; promoting any other field to
        // required would break every existing pipeline at compile time, and
        // demoting `cwd` would silently resolve paths against process.cwd().
        expectTypeOf<PublishUpdateOptions>().toEqualTypeOf<{
            cwd: string;
            bundle?: string;
            out?: string;
            channel?: string;
            appVersion?: string;
            mandatory?: boolean;
            notes?: string;
            runtimeVersion?: string;
            runtimeVersions?: { android?: string; ios?: string };
        }>();
    });

    it('pins the result envelope CI reads', () => {
        // These are consumed by release jobs as data (asserted on, echoed into
        // job summaries, used to build CDN URLs) rather than by code that would
        // fail to compile if a field vanished from a widened return type.
        expectTypeOf<PublishUpdateResult>().toEqualTypeOf<{
            updateId: string;
            sha256: string;
            bundleUrl: string;
            bundlePath: string;
            manifestPath: string;
            channel: string;
            appVersion: string;
            sizeBytes: number;
            mandatory: boolean;
            createdAt: string;
            runtimeVersions: Array<{ platform: PublishPlatform; runtimeVersion: string }>;
        }>();
    });

    it('keeps the platform union closed', () => {
        // `platform` is stamped into the manifest and matched verbatim by the
        // client's `StaticManifestProvider`; widening it to `string` would let
        // a typo publish an entry no device ever matches.
        expectTypeOf<PublishPlatform>().toEqualTypeOf<'android' | 'ios'>();
    });
});
