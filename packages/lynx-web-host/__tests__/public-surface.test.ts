/**
 * Public-surface freeze test for @sigx/lynx-web-host.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`LynxViewLike`, `InstallSigxWebHostOptions`, `SigxBrowserConfig`)
 *    are erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures — the uninstall callback (C7) and the
 *    option bag, which is the part consumers actually spell out.
 *
 * This package has **two** published entry points (`package.json#exports`):
 * the barrel `.` and the bundler-free `./host`, which `sigx run:web` serves
 * verbatim to the host page as `/host/sigx-host.js`. Both are frozen, because
 * `./host` is loaded by URL from generated HTML — a rename there fails at
 * runtime in the browser with nothing in the build to catch it.
 *
 * There is no web-parity block (D7.1b): this package *is* the web
 * implementation, so it ships no `.web.ts` sibling to compare against.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as webHost from '../src/index';
import * as host from '../src/host';
import type {
    InstallSigxWebHostOptions,
    LynxViewLike,
    SigxBrowserConfig,
} from '../src/host';

describe('public runtime exports', () => {
    it('matches the locked surface of the barrel', () => {
        expect(Object.keys(webHost).sort()).toEqual(['installSigxWebHost']);
    });

    it('matches the locked surface of the ./host entry point', () => {
        // The host page loads this module by URL, not through the barrel, so
        // its exports are a published contract in their own right.
        expect(Object.keys(host).sort()).toEqual(
            ['installSigxWebHost', 'viewportBrowserConfig'].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the install signature and its uninstall callback (C7)', () => {
        // `options` must stay optional — the generated host page and every
        // embedder in the wild call `installSigxWebHost(view)` with one
        // argument. And the return has to remain a plain `() => void`
        // teardown, not a Promise or a handle object: callers stash it in a
        // cleanup array and call it synchronously on unmount.
        expectTypeOf(webHost.installSigxWebHost).toEqualTypeOf<
            (lynxView: LynxViewLike, options?: InstallSigxWebHostOptions) => () => void
        >();
        // Written type-first rather than as `installSigxWebHost({})`:
        // `expectTypeOf` evaluates its argument, and installing against a bare
        // object would touch page globals this environment doesn't have.
        expectTypeOf<
            ReturnType<typeof webHost.installSigxWebHost>
        >().toEqualTypeOf<() => void>();
    });

    it('keeps every publisher opt-out optional and boolean', () => {
        // The options bag is opt-*out* only: each flag defaults to enabled and
        // is checked as `!== false`. Making one required, or widening one to a
        // non-boolean, silently changes what an existing `{}` call installs.
        expectTypeOf<InstallSigxWebHostOptions>().toEqualTypeOf<{
            appearance?: boolean;
            linking?: boolean;
            textColorInheritance?: boolean;
            viewport?: boolean;
            screen?: boolean;
            ignoreFocus?: boolean;
        }>();
    });

    it('keeps the lynx-view contract structural and fully optional', () => {
        // `LynxViewLike` deliberately duck-types upstream's `<lynx-view>` so we
        // carry no dependency on @lynx-js/web-core's types. Every member stays
        // optional because the element may not have upgraded yet when install
        // runs — requiring one would break callers passing a raw
        // `document.querySelector` result.
        expectTypeOf<LynxViewLike['updateGlobalProps']>().toEqualTypeOf<
            ((data: Record<string, unknown>) => void) | undefined
        >();
        expectTypeOf<LynxViewLike['sendGlobalEvent']>().toEqualTypeOf<
            ((name: string, params: unknown[]) => void) | undefined
        >();
        expectTypeOf<LynxViewLike['onNativeModulesCall']>().toEqualTypeOf<
            ((name: string, data: unknown, moduleName: string) => unknown) | undefined
        >();
    });

    it('keeps viewportBrowserConfig nullable (unmeasurable ≠ zero-sized)', () => {
        // `null` means "nothing measurable yet" and tells the caller to leave
        // web-core's SystemInfo alone; collapsing it to a zeroed config would
        // pin every layout that reads SCREEN_WIDTH/HEIGHT to 0 (#759).
        expectTypeOf(host.viewportBrowserConfig).toEqualTypeOf<
            (view?: LynxViewLike) => SigxBrowserConfig | null
        >();
        expectTypeOf<SigxBrowserConfig>().toEqualTypeOf<{
            pixelRatio: number;
            pixelWidth: number;
            pixelHeight: number;
        }>();
    });
});
