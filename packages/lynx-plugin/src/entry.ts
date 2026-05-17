/**
 * Dual-thread entry splitting for SignalX Lynx.
 *
 * For each user-defined rsbuild entry, creates two webpack entries:
 * - `<name>__main-thread` on the MAIN_THREAD layer (PAPI bootstrap via @sigx/lynx-runtime-main)
 * - `<name>` on the BACKGROUND layer (sigx renderer + user app)
 *
 * Then registers @lynx-js/template-webpack-plugin to stitch both bundles
 * into a single .lynx template.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RsbuildPluginAPI } from '@rsbuild/core';

import { LAYERS } from './layers.js';

const PLUGIN_TEMPLATE = 'lynx:sigx-template';
const PLUGIN_MARK_MAIN_THREAD = 'lynx:sigx-mark-main-thread';
const PLUGIN_ENCODE = 'lynx:sigx-encode';

const DEFAULT_INTERMEDIATE = '.rspeedy';

const _dirname = path.dirname(fileURLToPath(import.meta.url));

// sigx lynx-plugin package root — the plugin lives at <pkgRoot>/dist/,
// so we resolve one level up from _dirname.
const sigxLynxRoot = path.resolve(_dirname, '..');

/** Minimal typing for a webpack Chunk (avoids importing @rspack/core). */
interface WebpackChunk {
  getEntryOptions(): { layer?: string } | undefined;
}

/** Minimal typing for the webpack Compilation object. */
interface WebpackCompilation {
  hooks: {
    processAssets: {
      tap(
        options: { name: string; stage: number },
        callback: () => void,
      ): void;
    };
    additionalTreeRuntimeRequirements: {
      tap(
        name: string,
        callback: (chunk: WebpackChunk, set: Set<string>) => void,
      ): void;
    };
  };
  getAsset(
    filename: string,
  ): { source: unknown; info: Record<string, unknown> } | undefined;
  updateAsset(
    filename: string,
    source: unknown,
    info: Record<string, unknown>,
  ): void;
}

/** Minimal typing for the webpack Compiler object. */
interface WebpackCompiler {
  webpack: {
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONAL: number;
    };
    RuntimeGlobals: { startup: string; require: string };
    sources: { RawSource: new (source: string) => unknown };
  };
  hooks: {
    thisCompilation: {
      tap(
        name: string,
        callback: (compilation: WebpackCompilation) => void,
      ): void;
    };
  };
}

/**
 * SigxMarkMainThreadPlugin forces webpack to generate startup code for MT
 * entry chunks and marks their assets with `lynx:main-thread: true` so
 * LynxTemplatePlugin routes them to lepusCode.root (Lepus bytecode).
 */
class SigxMarkMainThreadPlugin {
  constructor(private readonly mainThreadFilenames: string[]) {}

  apply(compiler: WebpackCompiler): void {
    const { RuntimeGlobals } = compiler.webpack;

    compiler.hooks.thisCompilation.tap(
      PLUGIN_MARK_MAIN_THREAD,
      (compilation) => {
        // Force startup code generation for MT entry chunks.
        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          PLUGIN_MARK_MAIN_THREAD,
          (chunk, set) => {
            const entryOptions = chunk.getEntryOptions();
            if (entryOptions?.layer === LAYERS.MAIN_THREAD) {
              set.add(RuntimeGlobals.startup);
              set.add(RuntimeGlobals.require);
            }
          },
        );

        // Mark MT assets with lynx:main-thread: true for LynxTemplatePlugin.
        compilation.hooks.processAssets.tap(
          {
            name: PLUGIN_MARK_MAIN_THREAD,
            stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
          },
          () => {
            for (const filename of this.mainThreadFilenames) {
              const asset = compilation.getAsset(filename);
              if (asset) {
                compilation.updateAsset(filename, asset.source, {
                  ...asset.info,
                  'lynx:main-thread': true,
                });
              }
            }
          },
        );
      },
    );
  }
}

export interface ApplyEntryOptions {
  enableCSSSelector?: boolean;
  enableCSSInheritance?: boolean;
  customCSSInheritanceList?: string[];
  debugInfoOutside?: boolean;
}

export async function applyEntry(
  api: RsbuildPluginAPI,
  opts: ApplyEntryOptions = {},
): Promise<void> {
  // Preload @lynx-js/template-webpack-plugin via dynamic ESM import.
  // rsbuild bundlerChain callbacks are sync, and template-webpack-plugin
  // is pure-ESM (no "require" condition in its exports map), so createRequire
  // fails. Stash the module in closure scope for the sync callback below.
  let templateMod:
    | typeof import('@lynx-js/template-webpack-plugin')
    | undefined;
  try {
    templateMod = await import('@lynx-js/template-webpack-plugin');
  } catch {
    // Optional peer — if missing, we'll still emit the two JS bundles.
  }

  // Preload @lynx-js/runtime-wrapper-webpack-plugin. This wraps the BG bundle
  // in `__init_card_bundle__(lynxCoreInject, lynx, ...)` so user code inside
  // can reference `lynx` and `lynxCoreInject` as bare identifiers — that's
  // how the BG transport (lynx.getNativeApp().callLepusMethod) and the event
  // dispatcher (lynxCoreInject.tt.publishEvent) get installed properly.
  // Without this wrapper we'd be forced to spelunk through globalThis.multiApps.
  let wrapperMod:
    | { RuntimeWrapperWebpackPlugin: new (opts: { test: RegExp; targetSdk?: string }) => unknown }
    | undefined;
  try {
    wrapperMod = (await import('@lynx-js/runtime-wrapper-webpack-plugin')) as typeof wrapperMod;
  } catch {
    // Optional peer — if missing, lynx-runtime will still attempt the
    // multiApps[appId]._nativeApp fallback, but proper hosts need the wrapper.
  }

  // Default to all-in-one chunk splitting to avoid async chunks that break
  // Lynx's single-file bundle requirement.
  api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) => {
    const userConfig = api.getRsbuildConfig('original');
    if (!userConfig.performance?.chunkSplit?.strategy) {
      return mergeRsbuildConfig(config, {
        performance: { chunkSplit: { strategy: 'all-in-one' } },
      });
    }
    return config;
  });

  // Exclude main-thread chunks from chunk splitting so each remains
  // self-contained.
  api.modifyRspackConfig((rspackConfig) => {
    if (!rspackConfig.optimization) return rspackConfig;

    if (rspackConfig.optimization.splitChunks === false) {
      rspackConfig.optimization.splitChunks = {};
    }

    if (rspackConfig.optimization.splitChunks) {
      const prev = rspackConfig.optimization.splitChunks.chunks;
      // biome-ignore lint/suspicious/noExplicitAny: rspack Chunk type not importable
      rspackConfig.optimization.splitChunks.chunks = (chunk: any) => {
        if (chunk.name?.includes('__main-thread')) return false;
        if (typeof prev === 'function') return prev(chunk);
        if (prev === 'all') return true;
        if (prev === 'initial') return true;
        return false;
      };
    }

    return rspackConfig;
  });

  api.modifyBundlerChain((chain, { environment, isProd }) => {
    const isRspeedy = api.context.callerName === 'rspeedy';
    if (!isRspeedy) return;

    const isDev = !isProd;
    const isLynx =
      environment.name === 'lynx' || environment.name.startsWith('lynx-');
    const isWeb =
      environment.name === 'web' || environment.name.startsWith('web-');

    // HMR / Live Reload flags (same logic as vue-lynx / React plugin)
    const { hmr, liveReload } = environment.config.dev ?? {};
    const enabledHMR = isDev && !isWeb && hmr !== false;
    const enabledLiveReload = isDev && !isWeb && liveReload !== false;

    const entries = chain.entryPoints.entries() ?? {};

    chain.entryPoints.clear();

    // Collect all main-thread filenames to mark with lynx:main-thread
    const mainThreadFilenames: string[] = [];

    for (const [entryName, entryPoint] of Object.entries(entries)) {
      // Collect user imports from the original entry
      const imports: string[] = [];
      const ep = entryPoint as { values(): Iterable<unknown> };
      for (const val of ep.values()) {
        if (typeof val === 'string') {
          imports.push(val);
        } else if (typeof val === 'object' && val !== null && 'import' in val) {
          const imp = (val as { import?: string | string[] }).import;
          if (Array.isArray(imp)) imports.push(...imp);
          else if (imp) imports.push(imp);
        }
      }

      // ----------------------------------------------------------------
      // Filenames
      // ----------------------------------------------------------------
      const intermediate = isLynx ? DEFAULT_INTERMEDIATE : '';
      const mainThreadEntry = `${entryName}__main-thread`;
      const mainThreadName = path.posix.join(
        intermediate,
        `${entryName}/main-thread.js`,
      );
      const backgroundName = path.posix.join(
        intermediate,
        `${entryName}/background${isProd ? '.[contenthash:8]' : ''}.js`,
      );

      if (isLynx || isWeb) {
        mainThreadFilenames.push(mainThreadName);
      }

      // ----------------------------------------------------------------
      // Main Thread bundle – PAPI bootstrap only
      // ----------------------------------------------------------------
      // The MT entry ONLY imports @sigx/lynx-runtime-main, which registers
      // globalThis.renderPage, processData, sigxPatchUpdate and bridges
      // ops from the background thread.
      //
      // MT bundle evaluation order (critical):
      //   The bootstrap (entry-main → worklet-runtime → install-hybrid-worklet)
      //   is prepended to every user file by `worklet-loader-mt.ts` using
      //   absolute paths resolved from the loader's install location. That
      //   means we DON'T list those modules here as entry imports — the dep
      //   graph that the loader-emitted preamble creates pulls them in, in
      //   the right order, without forcing the user's app package.json to
      //   declare @lynx-js/react as a direct dep.
      //
      //   So the MT entry list is just: user imports. (CSS HMR runtime in
      //   dev mode only.) Worklet registrations land via the dep graph.
      const mainThreadImports = !enabledHMR
        ? [...imports]
        : [
            '@lynx-js/css-extract-webpack-plugin/runtime/hotModuleReplacement.lepus.cjs',
            ...imports,
          ];

      chain
        .entry(mainThreadEntry)
        .add({
          layer: LAYERS.MAIN_THREAD,
          import: mainThreadImports,
          filename: mainThreadName,
        })
        .end();

      // ----------------------------------------------------------------
      // Background bundle – sigx renderer + user app
      // ----------------------------------------------------------------
      const bgImports: string[] = [];
      bgImports.push(...imports);

      const bgEntry = chain
        .entry(entryName)
        .add({
          layer: LAYERS.BACKGROUND,
          import: bgImports,
          filename: backgroundName,
        });

      // Inject standard rspack HMR client + Lynx WebSocket transport into
      // the BG entry (matching vue-lynx's approach). These must be prepended
      // so they initialise before user code.
      if (enabledHMR) {
        bgEntry.prepend({
          layer: LAYERS.BACKGROUND,
          import: '@rspack/core/hot/dev-server',
        });
        // BG → MT hot-update bridge. Subscribes to the same `webpackHotUpdate`
        // emitter event as `@rspack/core/hot/dev-server`, fetches the matching
        // `main__main-thread.<hash>.hot-update.js`, and forwards extracted
        // `registerWorkletInternal` calls to MT via `callLepusMethod`. Without
        // this, MT's `_workletMap` keeps the old worklet IDs from the static
        // bundle while BG sends ops referencing new content-hash IDs after a
        // save → bind-of-undefined on tap.
        bgEntry.prepend({
          layer: LAYERS.BACKGROUND,
          import: '@sigx/lynx-runtime/mt-hmr-bridge',
        });
      }
      if (enabledHMR || enabledLiveReload) {
        bgEntry.prepend({
          layer: LAYERS.BACKGROUND,
          import: '@lynx-js/webpack-dev-transport/client',
        });
      }

      bgEntry.end();

      // ----------------------------------------------------------------
      // LynxTemplatePlugin – packages both bundles into .lynx template
      // ----------------------------------------------------------------
      if ((isLynx || isWeb) && templateMod) {
        {
          const { LynxTemplatePlugin } = templateMod;

          const templateFilename =
            (typeof environment.config.output.filename === 'object'
              ? (environment.config.output.filename as { bundle?: string })
                  .bundle
              : environment.config.output.filename) ??
            '[name].[platform].bundle';

          chain
            .plugin(`${PLUGIN_TEMPLATE}-${entryName}`)
            .use(LynxTemplatePlugin, [
              {
                ...LynxTemplatePlugin.defaultOptions,
                dsl: 'react_nodiff',
                chunks: [mainThreadEntry, entryName],
                filename: templateFilename
                  .replaceAll('[name]', entryName)
                  .replaceAll('[platform]', environment.name),
                intermediate: path.posix.join(intermediate, entryName),
                debugInfoOutside: opts.debugInfoOutside ?? true,
                enableCSSSelector: opts.enableCSSSelector ?? true,
                enableCSSInvalidation: opts.enableCSSSelector ?? true,
                enableCSSInheritance: opts.enableCSSInheritance ?? false,
                customCSSInheritanceList: opts.customCSSInheritanceList,
                enableRemoveCSSScope: true,
                enableNewGesture: true,
                removeDescendantSelectorScope: true,
                cssPlugins: [],
              },
            ])
            .end();
        }
      }
    }

    // ------------------------------------------------------------------
    // SigxMarkMainThreadPlugin – mark MT assets for LynxTemplatePlugin
    // ------------------------------------------------------------------
    if ((isLynx || isWeb) && mainThreadFilenames.length > 0) {
      chain
        .plugin(PLUGIN_MARK_MAIN_THREAD)
        .use(SigxMarkMainThreadPlugin, [mainThreadFilenames])
        .end();
    }

    // ------------------------------------------------------------------
    // RuntimeWrapperWebpackPlugin – wrap BG bundle (NOT main-thread.js)
    // in __init_card_bundle__(lynxCoreInject, lynx, ...). Inside the
    // wrapper, lynx-runtime code can reference `lynx` and `lynxCoreInject`
    // as bare identifiers, giving us the official BG → MT bridge and
    // event dispatch hooks.
    // ------------------------------------------------------------------
    if (isLynx && wrapperMod) {
      const { RuntimeWrapperWebpackPlugin } = wrapperMod;
      chain
        .plugin('lynx:sigx-runtime-wrapper')
        .use(RuntimeWrapperWebpackPlugin, [
          {
            // Wrap everything except main-thread.js (and main-thread.[hash].js).
            test: /^(?!.*main-thread(?:\.[A-Fa-f0-9]*)?\.js$).*\.js$/,
          },
        ])
        .end();
    }

    // ------------------------------------------------------------------
    // LynxEncodePlugin – binary-encode the .lynx template
    // ------------------------------------------------------------------
    if (isLynx && templateMod) {
      const { LynxEncodePlugin } = templateMod;
      chain
        .plugin(PLUGIN_ENCODE)
        .use(LynxEncodePlugin, [{}])
        .end();
    }

    // ------------------------------------------------------------------
    // HMR loader – inject registerHMRModule() + module.hot.accept()
    // into component files on the BG layer so they self-accept hot
    // updates and patch instances in-place (no structural tree ops).
    // ------------------------------------------------------------------
    if (enabledHMR) {
      chain.module
        .rule('sigx-hmr')
        .test(/\.[jt]sx?$/)
        .issuerLayer(LAYERS.BACKGROUND)
        .exclude
          .add(/node_modules/)
          .add(/dist/)
          .end()
        .enforce('pre')
        .use('sigx-hmr-loader')
          .loader(path.resolve(_dirname, './loaders/hmr-loader'))
          .end();
    }

    // ------------------------------------------------------------------
    // Worklet loaders — both layers run @lynx-js/react/transform.
    // BG layer: target='JS' replaces 'main thread' functions with
    //           { _wkltId, _c? } placeholders shipped via SET_WORKLET_EVENT.
    // MT layer: target='LEPUS' produces registerWorkletInternal(...) calls;
    //           the loader extracts those + local-import edges, dropping
    //           user component code so Lepus never executes it.
    // ------------------------------------------------------------------
    // TODO(framework): cleanly support pre-built `@sigx/*` packages that
    // ship `'main thread'` worklet bodies in their dist (motion, gestures).
    // Their directives are inert strings when the transform never sees
    // them, so SharedValue writes from those packages run on BG and
    // animations don't tick. A naive `include @sigx/*` blew up because
    // the MT loader (`target: 'LEPUS'`) drops non-worklet code — that
    // strips MT globals (`updateGlobalProps`, `sigxRunOnMT`, `processData`)
    // out of `@sigx/lynx-runtime-main` and the app refuses to boot.
    // Proper fix needs either a per-package opt-in via package.json
    // metadata (e.g. `"sigxLynx": { "worklets": true }`) or shipping
    // motion/gestures as TS source so the consumer's plugin processes
    // them via the normal user-code path. For now: revert to broad
    // exclude; framework consumers don't get animations from
    // pre-published motion/gestures, but the app boots.
    chain.module
      .rule('sigx-worklet')
      .test(/\.[jt]sx?$/)
      .issuerLayer(LAYERS.BACKGROUND)
      .exclude
        .add(/node_modules/)
        .add(/dist/)
        .end()
      .enforce('pre')
      .use('sigx-worklet-loader')
        .loader(path.resolve(_dirname, './loaders/worklet-loader'))
        .end();

    chain.module
      .rule('sigx-worklet-mt')
      .test(/\.[jt]sx?$/)
      .issuerLayer(LAYERS.MAIN_THREAD)
      .exclude
        .add(/node_modules/)
        .add(/dist/)
        .end()
      .enforce('pre')
      .use('sigx-worklet-mt-loader')
        .loader(path.resolve(_dirname, './loaders/worklet-loader-mt'))
        .end();

    // Disable IIFE wrapping – Lynx handles module scoping itself
    chain.output.set('iife', false);
  });
}
