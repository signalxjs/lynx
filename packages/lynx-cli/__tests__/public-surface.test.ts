/**
 * Public-surface freeze test for @sigx/lynx-cli.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect.
 *  - Types: the load-bearing signatures are pinned, because these are the
 *    shapes third-party config files, module manifests and CI publish scripts
 *    are written against — a widened return type here is a silent break there.
 *
 * This package is a build-time tool, not a native module, so most of
 * `CONVENTIONS.md` (C5–C8: subscriptions, permissions, worklet suffixes) has
 * no surface to apply to. The convention that does apply is C2: capability
 * probes stay synchronous booleans.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as cli from '../src/index';
import type { LynxConfig, ModuleManifest, ResolvedConfig } from '../src/index';
import type { AndroidLinkResult, IosLinkResult } from '../src/autolink/index';
import type { PublishUpdateResult } from '@sigx/lynx-updates-publisher';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        // `src/index.ts` re-exports whole barrels (`./config`, `./manifest`,
        // `./autolink`), so a new `export function` in any of those files
        // lands on the public API without anyone touching the barrel. This
        // list is the gate that makes that deliberate.
        expect(Object.keys(cli).sort()).toEqual(
            [
                // ./config
                'defineLynxConfig',
                'resolveConfig',
                'modulesForPlatform',
                'resolveAssets',
                // ./manifest
                'publisherClasses',
                'validateManifest',
                // ./autolink
                'linkAndroid',
                'linkIos',
                // orchestration
                'runPrebuild',
                'loadConfig',
                'loadManifests',
                'startDevServer',
                'runDoctor',
                // terminal / network helpers
                'generateQR',
                'getLanIP',
                'getAllLanIPs',
                // device detection
                'getDeviceStatus',
                'listAndroidDevices',
                'isAdbAvailable',
                'isLynxGoInstalled',
                'launchLynxGo',
                // OTA publishing
                'runUpdatesPublish',
                'publishUpdate',
            ].sort()
        );
    });
});

describe('public types', () => {
    it('keeps the capability probes synchronous booleans (C2)', () => {
        // `Biometric.isAvailable()` drifted into returning a Promise, which
        // makes `if (mod.isAvailable())` silently always true. The CLI's
        // probes are branched on the same way inside prebuild/dev-server.
        expectTypeOf(cli.isAdbAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(cli.isLynxGoInstalled).toEqualTypeOf<(deviceId: string) => boolean>();
        expectTypeOf(cli.isAdbAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the config entry points', () => {
        // `defineLynxConfig` is identity-typed on purpose: it exists so user
        // `lynx.config.ts` files get inference, so it must hand the *same*
        // type back rather than widening to `LynxConfig`-shaped-unknown.
        expectTypeOf(cli.defineLynxConfig).toEqualTypeOf<(config: LynxConfig) => LynxConfig>();
        expectTypeOf(cli.resolveConfig).toEqualTypeOf<
            (raw: LynxConfig, variantName?: string) => ResolvedConfig
        >();
    });

    it('pins the manifest validation contract', () => {
        // Errors are returned as a list, never thrown and never a boolean —
        // callers report every problem in one pass.
        expectTypeOf(cli.validateManifest).toEqualTypeOf<(manifest: unknown) => string[]>();
        expectTypeOf(cli.publisherClasses).toEqualTypeOf<
            (value: string | string[] | undefined) => string[]
        >();
    });

    it('pins the autolinkers', () => {
        expectTypeOf(cli.linkAndroid).toEqualTypeOf<
            (config: ResolvedConfig, manifests: ModuleManifest[]) => AndroidLinkResult
        >();
        expectTypeOf(cli.linkIos).parameters.toExtend<[ResolvedConfig, ModuleManifest[], ...never[]]>();
        expectTypeOf(cli.linkIos).returns.toEqualTypeOf<IosLinkResult>();
    });

    it('pins the programmatic publish result (consumed by CI scripts)', () => {
        // `@sigx/lynx-updates-publisher` is re-exported through this barrel so
        // CI can publish without pulling the whole CLI; the result fields are
        // read by those scripts.
        expectTypeOf(cli.runUpdatesPublish).returns.toEqualTypeOf<Promise<PublishUpdateResult>>();
        expectTypeOf<PublishUpdateResult['updateId']>().toEqualTypeOf<string>();
        expectTypeOf<PublishUpdateResult['sha256']>().toEqualTypeOf<string>();
    });

    it('pins the LAN discovery helpers', () => {
        // `null` (no usable interface) is a real case the dev server branches
        // on; narrowing this to `string` would break the fallback path.
        expectTypeOf(cli.getLanIP).toEqualTypeOf<() => string | null>();
        expectTypeOf(cli.getAllLanIPs).toEqualTypeOf<() => { name: string; address: string }[]>();
    });
});
