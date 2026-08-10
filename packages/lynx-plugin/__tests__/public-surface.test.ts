/**
 * Public-surface freeze test for @sigx/lynx-plugin.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`PluginSigxLynxOptions`) are erased at runtime and are pinned
 *    below instead.
 *  - Types: the load-bearing signatures. This is a build-time rsbuild plugin,
 *    not a native module, so the device-facing conventions (C2 `isAvailable`,
 *    C5 `cancelled` unions, C6 permissions, C7 unsubscribes, C8 `MT` hooks)
 *    have nothing to bind to here. What matters instead is that the surface a
 *    `lynx.config.ts` touches stays stable: the plugin factory's options bag
 *    is entirely optional, and the layer names are the string constants both
 *    worklet loaders and the runtime match against.
 *
 * Note: this package has no `.web.ts` sibling — it is the thing that *swaps*
 * web implementations in by `extensionAlias`, it does not have one — so there
 * is no web-parity block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { RsbuildPlugin, RsbuildPluginAPI } from '@rsbuild/core';

import * as plugin from '../src/index';
import type { PluginSigxLynxOptions } from '../src/index';
import type { ApplyEntryOptions } from '../src/entry';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(plugin).sort()).toEqual(
            [
                // The plugin factory — the only thing an app's lynx.config.ts
                // is expected to reach for.
                'pluginSigxLynx',
                // Webpack module layer names, re-exported from ./layers.js.
                'LAYERS',
                // Frozen as-is, not endorsed: `applyEntry` is the plugin's own
                // internal entry-splitting step, re-exported from the barrel.
                // The owning audit issue decides whether it stays public.
                'applyEntry',
            ].sort(),
        );
    });

    it('keeps the layer names stable', () => {
        // These strings are a cross-package contract, not an implementation
        // detail: the worklet/snapshot loaders and @sigx/lynx-runtime-internal
        // both branch on the literal layer name, so renaming one here silently
        // routes every module to the wrong thread.
        expect(Object.keys(plugin.LAYERS).sort()).toEqual(['BACKGROUND', 'MAIN_THREAD']);
        expect(plugin.LAYERS).toEqual({
            BACKGROUND: 'sigx:background',
            MAIN_THREAD: 'sigx:main-thread',
        });
    });
});

describe('public types', () => {
    it('pins the plugin factory signature', () => {
        // `pluginSigxLynx()` with no argument has to keep working — every
        // scaffolded lynx.config.ts calls it bare, so a required option would
        // break each one at typecheck.
        expectTypeOf(plugin.pluginSigxLynx).toEqualTypeOf<
            (options?: PluginSigxLynxOptions) => RsbuildPlugin
        >();
    });

    it('keeps every plugin option optional and its defaults implicit', () => {
        // The options bag is pure opt-in: each flag has a documented default
        // resolved inside the plugin, so `{}` must remain assignable. A flag
        // promoted to required would be a breaking config change disguised as
        // a feature.
        expectTypeOf<Record<string, never>>().toExtend<PluginSigxLynxOptions>();
        expectTypeOf<PluginSigxLynxOptions>().toEqualTypeOf<{
            enableCSSSelector?: boolean;
            enableCSSInheritance?: boolean;
            customCSSInheritanceList?: string[];
            enableCSSInlineVariables?: boolean;
            enableNewSticky?: boolean;
            enableElementApiNewRegistration?: boolean;
            enableCSSRule?: boolean;
            debugInfoOutside?: boolean;
            snapshots?: boolean;
            web?: boolean;
        }>();
    });

    it('pins applyEntry as an awaited step', () => {
        // rsbuild's own hook callbacks are sync, so `applyEntry` returning a
        // Promise is load-bearing — the plugin awaits it before wiring the
        // template plugins. Collapsing it to `void` would drop that await
        // without any call site failing to compile.
        expectTypeOf(plugin.applyEntry).toEqualTypeOf<
            (api: RsbuildPluginAPI, opts?: ApplyEntryOptions) => Promise<void>
        >();
    });

    it('keeps LAYERS a literal-typed const map', () => {
        // `as const` is the point: consumers narrow on the literal
        // 'sigx:main-thread', so widening to `string` compiles here but
        // silently defeats every exhaustive check downstream.
        expectTypeOf(plugin.LAYERS).toEqualTypeOf<{
            readonly BACKGROUND: 'sigx:background';
            readonly MAIN_THREAD: 'sigx:main-thread';
        }>();
    });
});
