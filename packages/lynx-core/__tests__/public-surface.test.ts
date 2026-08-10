/**
 * Public-surface freeze test for @sigx/lynx-core.
 *
 * Core is the base every other `@sigx/lynx-*` package imports — a removed or
 * renamed export here breaks 50+ packages at once, so the surface is locked
 * and CI fails before the change reaches consumers. When the surface changes
 * intentionally, update both the value snapshot and the type assertions here
 * in the same PR.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`.
 * Three layers:
 *  - Runtime: the set of *value* exports is exactly what we expect (type-only
 *    exports such as `PermissionResponse` never appear here).
 *  - Types: the shapes `CONVENTIONS.md` constrains — the shared permission
 *    envelope (C6), unsubscribe-returning subscriptions (C7), synchronous
 *    `isAvailable` (C2), and the `SV`/`MT` hook suffix contract (C8).
 *  - Web parity: `orientation.web.ts` is swapped in by the plugin's
 *    extensionAlias, so it has to expose the same methods as the native one.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as core from '../src/index';
import {
    AppState,
    DeviceInfo,
    Orientation,
    subscribeNative,
    useScreen,
    useScreenMT,
} from '../src/index';
import type { CoarseOrientation, PermissionResponse, ScreenMetrics } from '../src/index';
import type { Computed } from '@sigx/reactivity';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(core).sort()).toEqual(
            [
                // bridge
                'callAsync',
                'callSync',
                'getModule',
                'guardModule',
                'isModuleAvailable',
                // shared module contract (C4, C7, C10)
                'SigxError',
                'isSigxError',
                'subscribeNative',
                'unwrapNative',
                'unwrapNativeVoid',
                // web host bridge + binary helpers
                'arrayBufferToBase64',
                'base64ToArrayBuffer',
                'isWebHostAvailable',
                'webHostCall',
                // platform + device
                'DeviceInfo',
                'OS',
                'Platform',
                'select',
                // build variant (#530)
                'isBaseBuild',
                'isVariant',
                'variant',
                // app lifecycle (#607)
                'APP_STATE_EVENT',
                'AppState',
                'useAppState',
                // OS font scale (#766)
                'FONT_SCALE_EVENT',
                'FONT_SCALE_GLOBAL_KEY',
                'readGlobalFontScale',
                'useFontScale',
                'useFontScaleMT',
                // live screen metrics + orientation (#856)
                'Orientation',
                'SCREEN_EVENT',
                'SCREEN_GLOBAL_KEY',
                'readGlobalScreen',
                'useOrientation',
                'useScreen',
                'useScreenMT',
                // logging
                'addTransport',
                'clearTransports',
                'consoleTransport',
                'createLogger',
                'disableNamespace',
                'enableNamespace',
                'getLogLevel',
                'setLogLevel',
            ].sort(),
        );
    });

    it('exposes exactly the documented namespace methods', () => {
        // A method added to an ambient service reaches every consumer
        // unannounced; the README API tables have to grow with it.
        expect(Object.keys(Orientation).sort()).toEqual(['isAvailable', 'lock', 'unlock']);
        expect(Object.keys(DeviceInfo).sort()).toEqual(['getInfo', 'isAvailable']);
        // `current` / `available` are accessors, so they are own keys too.
        expect(Object.keys(AppState).sort()).toEqual(['available', 'current', 'subscribe']);
        expect(Object.keys(core.Platform).sort()).toEqual([
            'OS',
            'Version',
            'engineVersion',
            'isPad',
            'pixelHeight',
            'pixelRatio',
            'pixelWidth',
            'runtimeType',
            'select',
        ]);
    });
});

describe('public types', () => {
    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()` drifted
        // into returning a Promise, which makes `if (mod.isAvailable())`
        // silently always true. Core defines the shape the others copy.
        expectTypeOf(Orientation.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(DeviceInfo.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Orientation.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('subscriptions return a bare unsubscribe (C7)', () => {
        // Every module package's event API is built on `subscribeNative`, so
        // the disposer shape is load-bearing far beyond this package.
        expectTypeOf(subscribeNative<{ x: number }>).returns.toEqualTypeOf<() => void>();
        expectTypeOf(AppState.subscribe).returns.toEqualTypeOf<() => void>();
    });

    it('pins the shared permission envelope (C6)', () => {
        // Core owns no permission method itself — it owns the *type* the ~15
        // permission-holding packages return from `requestPermission()`.
        // Widening it here silently changes all of their public signatures.
        expectTypeOf<PermissionResponse>().toEqualTypeOf<{
            status: 'granted' | 'denied' | 'undetermined' | 'blocked';
            canAskAgain: boolean;
        }>();
    });

    it('honours the MT hook-suffix contract (C8)', () => {
        // The suffix *is* the return-type contract: unsuffixed hooks hand back
        // a reactive `Computed` for the background thread, `…MT` hands back a
        // plain snapshot readable inside a main-thread worklet.
        expectTypeOf(useScreen).returns.toEqualTypeOf<Computed<ScreenMetrics>>();
        expectTypeOf(useScreenMT).returns.toEqualTypeOf<ScreenMetrics>();
        expectTypeOf(core.useOrientation).returns.toEqualTypeOf<Computed<CoarseOrientation>>();
        expectTypeOf(core.useFontScaleMT).returns.toEqualTypeOf<number>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps orientation.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/orientation.web');
        expect(Object.keys(web.Orientation).sort()).toEqual(Object.keys(Orientation).sort());
    });
});
