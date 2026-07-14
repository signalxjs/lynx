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
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
    let merged = config;
    if (!userConfig.performance?.chunkSplit?.strategy) {
      merged = mergeRsbuildConfig(merged, {
        performance: { chunkSplit: { strategy: 'all-in-one' } },
      });
    }
    // Dynamic-import async chunks are still emitted regardless of the
    // strategy above. Pin the production assetPrefix so their request URLs
    // are root-relative (`/static/js/async/<hash>.js`) — the native
    // production fetchers map those 1:1 onto embedded assets (#599). Dev is
    // untouched: the dev assetPrefix is rewritten to the LAN dev-server URL.
    if (!userConfig.output?.assetPrefix) {
      merged = mergeRsbuildConfig(merged, { output: { assetPrefix: '/' } });
    }
    return merged;
  });

  // Surface emitted async chunks after production builds — they only load in
  // standalone apps when embedded by a release flow, and never over OTA. The
  // `sigx build` summary prints the same warning; this covers direct
  // `rspeedy build` invocations (external/CI pipelines). (#599)
  api.onAfterBuild(async () => {
    const { readdirSync } = await import('node:fs');
    const asyncDir = path.join(api.context.distPath, 'static', 'js', 'async');
    if (!existsSync(asyncDir)) return;
    const chunks = readdirSync(asyncDir, { recursive: true, encoding: 'utf-8' });
    if (chunks.length === 0) return;
    api.logger.info(
      `[sigx] ${chunks.length} async chunk(s) emitted by dynamic import() under static/js/async/. `
      + 'Standalone builds load them from embedded assets — embed via `sigx run:* --release` or '
      + '`sigx prebuild --embed-bundle`. OTA updates (`sigx updates:publish`) do NOT carry them.',
    );
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

  // Preload `@sigx/lynx-dev-client/install` — the JS-side console streamer.
  // We resolve it eagerly (rather than relying on the bundler's resolver)
  // so that:
  //   * absence of the package is detected once at config time (consumer may
  //     not depend on `@sigx/lynx-dev-client`), and
  //   * we can pass an absolute path to rspack's entry, sidestepping any
  //     subpath-export quirks.
  //
  // In linked / monorepo setups the plugin can live anywhere on disk, so we
  // try multiple resolution bases — `api.context.rootPath`, the current
  // process cwd, and finally the plugin's own location — and stop at the
  // first one that finds it. This covers monorepo workspaces where the
  // dev-client is hoisted to the workspace root as well as per-app installs.
  //
  // Returns `undefined` if the package isn't installed — the BG entry is
  // then left alone and log streaming is a silent no-op for that project.
  const resolveBases = [
    path.join(api.context.rootPath, 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ];
  let devClientInstallPath: string | undefined;
  for (const base of resolveBases) {
    try {
      devClientInstallPath = createRequire(base).resolve(
        '@sigx/lynx-dev-client/install',
      );
      break;
    } catch {
      // Subpath export may only declare `import` (Node CJS resolver wants
      // `require`/`default`). Fall back to locating package.json and
      // hand-constructing the path to dist/install.js.
      try {
        const pkgJson = createRequire(base).resolve(
          '@sigx/lynx-dev-client/package.json',
        );
        const candidate = path.join(path.dirname(pkgJson), 'dist', 'install.js');
        if (existsSync(candidate)) {
          devClientInstallPath = candidate;
          break;
        }
      } catch {
        // try next base
      }
    }
  }
  if (!devClientInstallPath) {
    try {
      devClientInstallPath = createRequire(import.meta.url).resolve(
        '@sigx/lynx-dev-client/install',
      );
    } catch {
      devClientInstallPath = undefined;
    }
  }
  if (devClientInstallPath) {
    api.logger.info(
      `[sigx-lynx] device console log streaming → enabled`,
    );
  } else {
    api.logger.warn(
      `[sigx-lynx] device console log streaming → disabled (install @sigx/lynx-dev-client as a devDependency of this app). rootPath=${api.context.rootPath}, cwd=${process.cwd()}`,
    );
  }

  // Auto-wire `@sigx/lynx-observability` in release builds when the app's
  // `signalx.config.ts` declares `logging.production` (plumbed via the
  // `SIGX_LYNX_LOGGING` env by `@sigx/lynx-cli`). Resolve its install entry the
  // same way as the dev-client, and prepend it to the BG entry below so error
  // capture + the remote sink are wired before app code runs — no manual
  // `initObservability()` call needed.
  // Only relevant for release builds (the prepend below is `isProd`-gated);
  // resolving/logging in dev would emit a misleading "enabled" message.
  const isReleaseBuild = process.env['NODE_ENV'] === 'production';
  let hasProductionLogging = false;
  if (isReleaseBuild) {
    try {
      const raw = process.env['SIGX_LYNX_LOGGING'];
      const parsed = raw ? (JSON.parse(raw) as { production?: unknown }) : undefined;
      hasProductionLogging = !!(parsed && typeof parsed === 'object' && parsed.production);
    } catch { /* malformed — treat as unset */ }
  }

  let observabilityInstallPath: string | undefined;
  if (hasProductionLogging) {
    for (const base of resolveBases) {
      try {
        observabilityInstallPath = createRequire(base).resolve('@sigx/lynx-observability/install');
        break;
      } catch {
        try {
          const pkgJson = createRequire(base).resolve('@sigx/lynx-observability/package.json');
          const candidate = path.join(path.dirname(pkgJson), 'dist', 'install.js');
          if (existsSync(candidate)) { observabilityInstallPath = candidate; break; }
        } catch { /* try next base */ }
      }
    }
    if (!observabilityInstallPath) {
      try {
        observabilityInstallPath = createRequire(import.meta.url).resolve('@sigx/lynx-observability/install');
      } catch { observabilityInstallPath = undefined; }
    }
    if (observabilityInstallPath) {
      api.logger.info('[sigx-lynx] production observability → enabled');
    } else {
      api.logger.warn('[sigx-lynx] logging.production is set but @sigx/lynx-observability is not installed — add it as a dependency.');
    }
  }

  api.modifyBundlerChain((chain, { environment, isProd }) => {
    const isRspeedy = api.context.callerName === 'rspeedy';
    if (!isRspeedy) return;

    const isDev = !isProd;
    const isLynx =
      environment.name === 'lynx' || environment.name.startsWith('lynx-');
    const isWeb =
      environment.name === 'web' || environment.name.startsWith('web-');

    // Make a *bare* `fetch`/`FormData`/`Headers`/`Response` resolve to the
    // `@sigx/lynx-http` implementations. On the Lynx BG runtime the whole
    // bundle is wrapped in one `tt.define(…, function(…, fetch, …))` factory,
    // so a bare `fetch` identifier binds to the engine's factory parameter (a
    // non-WHATWG fetch whose `Response` has no `.headers`) — patching
    // `globalThis.fetch` can't override it. ProvidePlugin rewrites these free
    // identifiers to module imports during compilation (before the factory
    // wrapping), so app code can call a bare `fetch(...)` and get the sigx
    // stack. Lynx-only: on web the host's real fetch is correct and `sigxFetch`
    // (which calls the native `Http` module) wouldn't work. `TextDecoder` is
    // intentionally NOT provided — the lynx-http install only shims it when
    // absent, so we keep any host-provided one. (signalxjs/lynx#373, #378.)
    if (isLynx) {
      // Lazy `require` so `@rspack/core` stays an OPTIONAL peer — importing it
      // at the top would make it a hard runtime requirement even for consumers
      // that never build (type-only, web-only). Here we're in a real rspeedy
      // Lynx build, so rspack is present.
      const { ProvidePlugin } = createRequire(import.meta.url)('@rspack/core') as typeof import('@rspack/core');
      chain
        .plugin('sigx-lynx-http-globals')
        .use(ProvidePlugin, [{
          fetch: ['@sigx/lynx-http', 'fetch'],
          FormData: ['@sigx/lynx-http', 'FormData'],
          Headers: ['@sigx/lynx-http', 'Headers'],
          Response: ['@sigx/lynx-http', 'Response'],
        }]);
    }

    // Platform tier-2 (build-time). `__WEB__` / `__NATIVE__` are folded to
    // literals per environment so app code can branch on them and have the
    // dead platform's branch tree-shaken (the runtime `Platform.OS` is a
    // convenience that does NOT tree-shake — a property read can't fold). The
    // `@sigx/lynx-core` Platform module reads `__WEB__` to drop native
    // detection from the web bundle. Lazy `require` for the same reason as the
    // HTTP globals above — keep `@rspack/core` an optional peer.
    {
      const { DefinePlugin } = createRequire(import.meta.url)('@rspack/core') as typeof import('@rspack/core');
      chain
        .plugin('sigx-platform-define')
        .use(DefinePlugin, [{
          __WEB__: JSON.stringify(isWeb),
          __NATIVE__: JSON.stringify(!isWeb),
        }]);

      // Platform file-extension resolution: `Foo.web.tsx` wins on the web
      // bundle, `Foo.lynx.tsx` / `Foo.native.tsx` on the native bundle, each
      // ahead of the generic `Foo.tsx`. Only web↔native swaps work this way —
      // iOS↔Android share one native bundle, so use `Platform.OS` at runtime
      // for those. Prepend in reverse so the array's first entry ends up first.
      const platformExts = isWeb
        ? ['.web.tsx', '.web.ts', '.web.jsx', '.web.js']
        : ['.lynx.tsx', '.lynx.ts', '.lynx.jsx', '.lynx.js',
           '.native.tsx', '.native.ts', '.native.jsx', '.native.js'];
      for (let i = platformExts.length - 1; i >= 0; i--) {
        chain.resolve.extensions.prepend(platformExts[i]);
      }
    }

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

      // Auto-install the console log streamer in dev. Prepended LAST so
      // it runs FIRST at runtime (after webpack-dev-transport so the
      // dev URL is plumbed). Skipped if the dev-client package isn't
      // installed in the consuming project.
      if (isDev && !isWeb && devClientInstallPath) {
        bgEntry.prepend({
          layer: LAYERS.BACKGROUND,
          import: devClientInstallPath,
        });
      }

      // Auto-wire production observability in release builds (when configured +
      // installed). Prepended so error capture + the sink are live before app
      // code runs. Dev uses the console streamer above; release uses this.
      if (isProd && !isWeb && observabilityInstallPath) {
        bgEntry.prepend({
          layer: LAYERS.BACKGROUND,
          import: observabilityInstallPath,
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
    //
    // Native (lynx) ONLY. Upstream `@lynx-js/web-core`'s worker runtime does
    // NOT use the `__init_card_bundle__` calling convention (the string
    // appears nowhere in its engine bundles) — it evaluates the background
    // bundle at the worker's global scope and supplies `lynx` /
    // `lynxCoreInject` as worker globals. Wrapping the BG bundle on web would
    // define `__init_card_bundle__` and never call it, so the BG body never
    // runs and no ops are ever sent (the page root renders empty). The bare
    // `lynx` / `lynxCoreInject` references in `op-queue.ts` resolve straight
    // to those worker globals, so web needs no wrapper.
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
    // Encode plugin – finalizes the template emitted by LynxTemplatePlugin.
    //   * native (lynx): LynxEncodePlugin binary-encodes the `.lynx` template.
    //   * web: WebEncodePlugin produces the un-encoded web template
    //     (`main.web.bundle`) that upstream `@lynx-js/web-core`'s
    //     `<lynx-view>` loads in the browser.
    // Exactly one must run per environment — without an encoder the template
    // plugin's emit leaves an undefined result that downstream code
    // destructures (`Cannot destructure property 'buffer' …`).
    // ------------------------------------------------------------------
    if (isLynx && templateMod) {
      const { LynxEncodePlugin } = templateMod;
      chain
        .plugin(PLUGIN_ENCODE)
        .use(LynxEncodePlugin, [{}])
        .end();
    }
    if (isWeb && templateMod) {
      const { WebEncodePlugin } = templateMod;
      // `WebEncodePlugin` was added to @lynx-js/template-webpack-plugin after
      // the encode split; older versions in the (loose) peer range export only
      // `LynxEncodePlugin`. Fail loudly here rather than letting
      // `.use(undefined, …)` throw an opaque "is not a constructor" later.
      if (!WebEncodePlugin) {
        throw new Error(
          '[sigx-lynx] The `web` environment requires `WebEncodePlugin` from ' +
            '@lynx-js/template-webpack-plugin, but the installed version does ' +
            'not export it. Upgrade @lynx-js/template-webpack-plugin (>=0.11) ' +
            'or remove the `web` environment from your config.',
        );
      }
      chain
        .plugin(PLUGIN_ENCODE)
        .use(WebEncodePlugin, [{}])
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
    //           the loader extracts those + local-import edges.
    //
    // Rules run on every JS/TS file in their respective layer — no
    // package allowlist and no `node_modules`/`dist` rule exclude. The
    // loaders gate themselves on directive presence (cheap regex
    // pre-filter, then SWC). The MT loader additionally branches on the
    // file's path because rspack shares module identity across BG/MT
    // layers — see the decision table in `worklet-loader-mt.ts` — so an
    // MT-side body strip of a library file would wipe its named exports
    // for BG consumers too. That MT-side preservation keeps
    // `@sigx/lynx-runtime-main`'s MT globals (`processData`,
    // `updateGlobalProps`, `sigxRunOnMT`) and lets cross-package
    // consumers like `@sigx/lynx-daisyui` resolve named imports
    // (`useTabs`, `useScreenChrome`) from worklet-shipping packages.
    //
    // The BG loader has no path branch; for directive-bearing files
    // (user or library) it returns the JS-target transform output,
    // which preserves exports while replacing worklet bodies with
    // `{ _wkltId }` placeholders. New packages that ship `'main thread'`
    // directives in their dist are picked up automatically — no
    // manual opt-in.
    chain.module
      .rule('sigx-worklet')
      .test(/\.[jt]sx?$/)
      .issuerLayer(LAYERS.BACKGROUND)
      .enforce('pre')
      .use('sigx-worklet-loader')
        .loader(path.resolve(_dirname, './loaders/worklet-loader'))
        .end();

    chain.module
      .rule('sigx-worklet-mt')
      .test(/\.[jt]sx?$/)
      .issuerLayer(LAYERS.MAIN_THREAD)
      .enforce('pre')
      .use('sigx-worklet-mt-loader')
        .loader(path.resolve(_dirname, './loaders/worklet-loader-mt'))
        .end();

    // Disable IIFE wrapping – Lynx handles module scoping itself
    chain.output.set('iife', false);
  });
}
