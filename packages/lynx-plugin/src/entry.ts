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
const PLUGIN_PAGE_CONFIG = 'lynx:sigx-page-config';
const PLUGIN_ASYNC_CHUNK = 'lynx:sigx-async-chunk';
const PLUGIN_WORKLET_GUARD = 'lynx:sigx-worklet-guard';

/**
 * `RuntimeGlobals.lynxAsyncChunkIds` from `@lynx-js/webpack-runtime-globals`.
 * Inlined rather than imported: that package is not a declared dependency here,
 * and the value has been stable across its releases (0.0.6, 0.0.7).
 */
const LYNX_ASYNC_CHUNK_IDS = '__webpack_require__.lynx_aci';

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
    runtimeRequirementInTree: {
      for(runtimeGlobal: string): {
        tap(
          name: string,
          callback: (chunk: WebpackChunk, set: Set<string>) => void,
        ): void;
      };
    };
  };
  addRuntimeModule(chunk: WebpackChunk, module: unknown): void;
  errors: Error[];
  getAssets(): { name: string; source: { source(): string | Buffer } }[];
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
      PROCESS_ASSETS_STAGE_REPORT: number;
    };
    WebpackError: new (message: string) => Error;
    RuntimeGlobals: { startup: string; require: string };
    sources: { RawSource: new (source: string) => unknown };
    RuntimeModule: {
      new (name: string, stage?: number): { generate(): string };
      STAGE_TRIGGER: number;
    };
  };
  options: { output: { chunkFilename?: unknown } };
  hooks: {
    thisCompilation: {
      tap(
        name: string,
        callback: (compilation: WebpackCompilation) => void,
      ): void;
    };
    environment: { tap(name: string, callback: () => void): void };
    afterEnvironment: { tap(name: string, callback: () => void): void };
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

/**
 * SigxWorkletGuardPlugin fails the build when a worklet exists on the
 * background layer but was never registered on the main thread.
 *
 * The two layers carry the same worklet as two halves that must agree: the BG
 * bundle keeps a `{_wkltId: "<id>"}` placeholder, and the MT bundle must carry
 * a matching `registerWorkletInternal("main-thread", "<id>", …)`. `runWorklet`
 * later looks the body up by that id. Nothing else in the toolchain compares
 * the two sets, and a mismatch is invisible: the build succeeds, the app
 * starts, and the worklet simply never fires — no gesture response, no
 * animation, no error.
 *
 * That is not hypothetical. Declaring `sideEffects: false` on packages that
 * contain worklets deleted 72 of 101 registrations while `typecheck`, `test`,
 * `lint` and `verify:pack` all stayed green (#1021, #1002). On the MT layer a
 * worklet module is imported for its registration side effect alone, so a
 * bundler that believes the package is side-effect-free is correct to drop it
 * — which is why this has to be checked against the emitted output rather than
 * prevented by a lint rule.
 *
 * Runs at `PROCESS_ASSETS_STAGE_REPORT`, one stage before `LynxEncodePlugin`
 * deletes the intermediate assets it folds into the template. Exported for
 * tests.
 */
export class SigxWorkletGuardPlugin {
  constructor(private readonly mainThreadFilenames: string[]) {}

  /** Worklet ids the BG bundle expects the MT layer to have registered. */
  static backgroundIds(source: string): Set<string> {
    return new Set(
      [...source.matchAll(/_wkltId:\s*["']([^"']+)["']/g)].map((m) => m[1]!),
    );
  }

  /** Worklet ids the MT bundle actually registers. */
  static mainThreadIds(source: string): Set<string> {
    return new Set(
      [
        ...source.matchAll(
          /registerWorkletInternal\(\s*["'][^"']*["']\s*,\s*["']([^"']+)["']/g,
        ),
      ].map((m) => m[1]!),
    );
  }

  /** The check itself, split out so it is testable without a compiler. */
  static missingIds(bgSource: string, mtSource: string): string[] {
    const mt = SigxWorkletGuardPlugin.mainThreadIds(mtSource);
    return [...SigxWorkletGuardPlugin.backgroundIds(bgSource)]
      .filter((id) => !mt.has(id))
      .sort();
  }

  apply(compiler: WebpackCompiler): void {
    const mtNames = new Set(this.mainThreadFilenames);
    compiler.hooks.thisCompilation.tap(PLUGIN_WORKLET_GUARD, (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_WORKLET_GUARD,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          let bg = '';
          let mt = '';
          for (const { name, source } of compilation.getAssets()) {
            if (!name.endsWith('.js')) continue;
            const text = String(source.source());
            if (mtNames.has(name)) mt += text;
            else bg += text;
          }
          // No MT output to compare against (e.g. a target that emits none):
          // stay silent rather than fail a build this cannot speak to.
          if (mt === '') return;

          const missing = SigxWorkletGuardPlugin.missingIds(bg, mt);
          if (missing.length === 0) return;

          const shown = missing.slice(0, 5).join(', ');
          const more = missing.length > 5
            ? ` (+${missing.length - 5} more)`
            : '';
          compilation.errors.push(
            new compiler.webpack.WebpackError(
              `[sigx] ${missing.length} worklet(s) were compiled into the `
              + `background bundle but never registered on the main thread, so `
              + `they would silently never run: ${shown}${more}.\n`
              + `Two things commonly cause this. Most often a package `
              + `containing 'main thread' worklets is tree-shaken out of the `
              + `main-thread layer — look for a "sideEffects" declaration `
              + `that excludes its worklet modules. It can also mean the `
              + `worklet is only reachable through a dynamic import(): the `
              + `main-thread layer resolves imports statically, so a module `
              + `no static import reaches never enters the MT bundle. See `
              + `#1021.`,
            ),
          );
        },
      );
    });
  }
}

/**
 * SigxPageConfigPlugin merges extra page-config keys into the encoded
 * template's `sourceContent.config` via LynxTemplatePlugin's `beforeEncode`
 * hook. LynxTemplatePlugin itself only emits a fixed key set, so keys the
 * native engine decodes but the template plugin doesn't know about (e.g.
 * `enableCSSInlineVariables`, decoded since Lynx 3.6) must be injected here.
 * Exported for tests.
 */
export class SigxPageConfigPlugin {
  constructor(
    private readonly templatePlugin: {
      getLynxTemplatePluginHooks(compilation: unknown): {
        beforeEncode: {
          tap(
            name: string,
            callback: (args: {
              encodeData: {
                sourceContent: { config: Record<string, unknown> };
              };
            }) => unknown,
          ): void;
        };
      };
    },
    private readonly config: Record<string, unknown>,
  ) {}

  apply(compiler: WebpackCompiler): void {
    compiler.hooks.thisCompilation.tap(PLUGIN_PAGE_CONFIG, (compilation) => {
      const hooks = this.templatePlugin.getLynxTemplatePluginHooks(compilation);
      hooks.beforeEncode.tap(PLUGIN_PAGE_CONFIG, (args) => {
        args.encodeData.sourceContent.config = {
          ...args.encodeData.sourceContent.config,
          ...this.config,
        };
        return args;
      });
    });
  }
}

/**
 * SigxAsyncChunkPlugin keeps dynamic `import()` on the resource-fetcher path
 * sigx actually implements (#599/#612), by resetting
 * `__webpack_require__.lynx_aci` to an empty map.
 *
 * `@lynx-js/chunk-loading-webpack-plugin`'s runtime branches on that map: a
 * chunk id present in it loads via `lynx.loadLazyBundle(...)`, everything else
 * via `lynx.requireModuleAsync(publicPath + getChunkScriptFilename(id))`.
 *
 * `lynx.loadLazyBundle` is not an engine API — it appears in no version of
 * `@lynx-js/types`. `@lynx-js/react` installs it on the `lynx` object as a
 * module side effect, and sigx's background bundle contains no `@lynx-js/react`
 * modules at all (the worklet loaders pass `dynamicImport: false` precisely so
 * the transform never injects that import). So the lazy-bundle branch can never
 * resolve here, and because the loader runs during bundle evaluation it took
 * the whole app down at `loadCard` rather than failing one deferred chunk
 * (#1015).
 *
 * Up to `@lynx-js/template-webpack-plugin` 0.13 this was latent: only chunk
 * groups with an explicit `webpackChunkName` entered `lynx_aci`, and sigx
 * produces none. 0.14 began synthesising a lazy-bundle name for *unnamed*
 * groups too, so every dynamic import moved onto the broken branch at once.
 *
 * Resetting the map is deliberately independent of that plugin's internals —
 * no tap-ordering race with its own `runtimeRequirementInTree` tap, and no
 * reliance on its `asyncChunkName` hook, which only ever sees named groups and
 * so cannot cover the unnamed ones that are the actual problem. The reset
 * module is registered at `STAGE_TRIGGER`, which sorts after the `STAGE_ATTACH`
 * module that populates the map, so the empty assignment lands last.
 *
 * Teaching sigx's runtime to load real lazy bundles is tracked separately; see
 * the follow-up issue linked from #1015. Exported for tests.
 */
export class SigxAsyncChunkPlugin {
  constructor(
    private readonly templatePlugin: {
      getLynxTemplatePluginHooks(compilation: unknown): {
        beforeEncode: {
          tap(
            name: string,
            callback: (args: {
              encodeData: {
                sourceContent: { appType?: string };
                manifest: Record<string, string>;
              };
            }) => unknown,
          ): void;
        };
      };
    },
  ) {}

  apply(compiler: WebpackCompiler): void {
    const { RuntimeModule } = compiler.webpack;

    // `@lynx-js/template-webpack-plugin` >= 0.14 also repoints
    // `output.chunkFilename` at `<intermediate>/lazy-bundle/<name>.js`, so the
    // plain JS chunk `requireModuleAsync` fetches stops being emitted at all —
    // leaving `dist/static/js/async/` empty and nothing for `embedAsyncAssets`
    // to carry into the app. Resetting the id map alone would therefore trade a
    // startup crash for a dynamic import that 404s at runtime.
    //
    // Both taps live here because the ordering is the whole trick: `environment`
    // fires after rspack has resolved its defaults and before the template
    // plugin's own `environment` tap (this plugin is registered first), so it
    // observes the real default; `afterEnvironment` then puts that value back,
    // after every `environment` tap has run.
    // Gate the restore on "did we capture", not on the captured value: an
    // original of `undefined` is meaningful (it means "let rspack apply its own
    // default"), and skipping the restore for it would leave the lazy-bundle
    // rewrite in place — the exact breakage this is here to undo.
    //
    // Only undo an actual rewrite, though. The template plugin installs a
    // *function*; rspack's resolved default is a string template. So if the
    // current value is no longer a function, something else deliberately set a
    // plain template after us — there is no rewrite left to undo, and stamping
    // our captured value over it would silently discard their choice.
    let originalChunkFilename: unknown;
    let capturedChunkFilename = false;
    compiler.hooks.environment.tap(PLUGIN_ASYNC_CHUNK, () => {
      originalChunkFilename = compiler.options.output.chunkFilename;
      capturedChunkFilename = true;
    });
    compiler.hooks.afterEnvironment.tap(PLUGIN_ASYNC_CHUNK, () => {
      if (!capturedChunkFilename) return;
      if (typeof compiler.options.output.chunkFilename !== 'function') return;
      compiler.options.output.chunkFilename = originalChunkFilename;
    });

    class SigxResetLynxAsyncChunkIds extends RuntimeModule {
      constructor() {
        super('sigx reset lynx async chunks', RuntimeModule.STAGE_TRIGGER);
      }

      override generate(): string {
        return (
          `// sigx (#1015): route every async chunk through\n`
          + `// lynx.requireModuleAsync — lynx.loadLazyBundle does not exist here.\n`
          + `${LYNX_ASYNC_CHUNK_IDS} = {};`
        );
      }
    }

    compiler.hooks.thisCompilation.tap(PLUGIN_ASYNC_CHUNK, (compilation) => {
      // Adding a runtime module re-enters requirement processing; without this
      // guard the tap would recurse on its own chunk.
      const seen = new WeakSet<WebpackChunk>();
      compilation.hooks.runtimeRequirementInTree
        .for(LYNX_ASYNC_CHUNK_IDS)
        .tap(PLUGIN_ASYNC_CHUNK, (chunk) => {
          if (seen.has(chunk)) return;
          seen.add(chunk);
          compilation.addRuntimeModule(
            chunk,
            new SigxResetLynxAsyncChunkIds(),
          );
        });

      // Neutralise the lazy-bundle templates themselves. `LynxEncodePlugin`
      // treats every chunk in a `DynamicComponent` manifest as inlinable
      // unconditionally — it folds them into the template and then *deletes*
      // the standalone assets, which is why `dist/static/js/async/` came out
      // empty no matter what `chunkFilename` said. Swapping the manifest for an
      // inert stub before that runs (stage 0, ahead of the encoder's 256) keeps
      // the real chunk files on disk for `requireModuleAsync` to fetch and for
      // `embedAsyncAssets` to carry into the app.
      //
      // The emitted `lazy-bundle/*.bundle` templates are then dead weight —
      // nothing resolves them, because `lynx_aci` is empty. They are left in
      // place rather than deleted so the output stays recognisable to anyone
      // comparing against an upstream build.
      //
      // This also subsumes the older web-only guard (#951): `WebEncodePlugin`
      // crashed destructuring `last(Object.entries(manifest))` when a chunk
      // group's JS had been deduplicated into the main chunk and its manifest
      // arrived empty. A stub is never empty.
      const hooks = this.templatePlugin.getLynxTemplatePluginHooks(compilation);
      hooks.beforeEncode.tap(PLUGIN_ASYNC_CHUNK, (args) => {
        const { encodeData } = args;
        if (encodeData.sourceContent.appType === 'DynamicComponent') {
          for (const name of Object.keys(encodeData.manifest)) {
            delete encodeData.manifest[name];
          }
          encodeData.manifest['/app-service.js'] = 'module.exports = {};';
        }
        return args;
      });
    });
  }
}

/**
 * Prepend the web variant to a `resolve.extensionAlias` list for `key`,
 * preserving whatever mapping already exists (rsbuild's tsconfig-driven
 * `.js → ['.js', '.ts', '.tsx']`) and falling back to the identity alias when
 * none does. Idempotent. Exported for tests.
 */
export function prependWebExtensionAlias(
  cur: string[] | string | undefined,
  key: string,
  webExt: string,
): string[] {
  const rest = cur == null ? [key] : Array.isArray(cur) ? cur : [cur];
  return [webExt, ...rest.filter((e) => e !== webExt)];
}

export interface ApplyEntryOptions {
  enableCSSSelector?: boolean;
  enableCSSInheritance?: boolean;
  customCSSInheritanceList?: string[];
  /**
   * Encode `enableCSSInlineVariables` into the template's page config so the
   * native engine (Lynx ≥ 3.6) registers CSS custom properties declared in
   * inline `style` and resolves `var(--*)` on descendants from first paint
   * (#116). Defaults to `true`; set `false` as a kill switch.
   */
  enableCSSInlineVariables?: boolean;
  /**
   * Encode `enableNewSticky` into the template's page config (Lynx 4.0+).
   * Defaults to `false`, matching upstream's own default — encoded rather
   * than omitted so an engine-side default flip can't silently change sticky
   * header layout under us.
   */
  enableNewSticky?: boolean;
  /**
   * Encode `enableElementApiNewRegistration` into the template's page config
   * (Lynx 4.0+). Defaults to `false` — the path every `<sigx-*>` element is
   * verified on. Unlike the other flags this one is `readSettings: true`
   * upstream, so a host setting can flip it; encoding it keeps that decision
   * ours.
   */
  enableElementApiNewRegistration?: boolean;
  /**
   * Encode `enableCSSRule` into the template's page config so the tasm
   * encoder routes stylesheets through its CSSRuleParser — the only path
   * that carries `@media` / `@supports` (ConditionRule) and `@layer` rules
   * into the binary; the legacy token path silently drops them (#951).
   * Defaults to `true`; set `false` as a kill switch. No effect below
   * @lynx-js/tasm 0.0.41 (template-webpack-plugin 0.14). When enabled the
   * encoder also forces `enableCSSSelector` and `enableCSSInvalidation` on.
   */
  enableCSSRule?: boolean;
  debugInfoOutside?: boolean;
  /** Enable the snapshot-template transform in both worklet loaders (#620). */
  snapshots?: boolean;
}

/**
 * Whether stylesheet at-rules (`@media`, `@supports`) survive into this
 * environment's binary — folded into the bundle as `__SIGX_CSS_RULE__`.
 *
 * Two independent ways to answer no, which is exactly why library code can't
 * infer it: the `enableCSSRule` kill switch, and the web target, whose encoder
 * drops the rules upstream no matter what the page config says. Exported for
 * tests.
 */
export function cssRulesReachBinary(
  opts: ApplyEntryOptions,
  isWeb: boolean,
): boolean {
  return !isWeb && (opts.enableCSSRule ?? true);
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
    // Only pin when genuinely unset — `assetPrefix: ''` is a deliberate
    // choice (relative URLs) the fetchers' marker fallback still resolves.
    if (userConfig.output?.assetPrefix == null) {
      merged = mergeRsbuildConfig(merged, { output: { assetPrefix: '/' } });
    }
    return merged;
  });

  // Surface emitted async chunks after production builds — they only load in
  // standalone apps when embedded by a release flow, and never over OTA. The
  // `sigx build` summary prints the same warning; this covers direct
  // `rspeedy build` invocations (external/CI pipelines). (#599)
  // This hook is pure diagnostics and runs once the build has already
  // succeeded, so everything below is wrapped: an fs hiccup or an unexpected
  // distPath must never be able to turn a green build red.
  api.onAfterBuild(async () => {
    try {
      const { readdirSync } = await import('node:fs');
      const asyncDir = path.join(api.context.distPath, 'static', 'js', 'async');
      if (!existsSync(asyncDir)) return;
      // Hand-rolled walk rather than `readdirSync(..., { recursive: true })` —
      // that option needs Node >= 18.17/20.1 and this plugin declares no engines
      // floor, so an older host would throw here and take the build down with it.
      const countFiles = (dir: string): number => {
        let n = 0;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          n += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
        }
        return n;
      };
      const chunkCount = countFiles(asyncDir);
      if (chunkCount === 0) return;
      api.logger.info(
        `[sigx] ${chunkCount} async chunk(s) emitted by dynamic import() under static/js/async/. `
        + 'Standalone builds load them from embedded assets — embed via `sigx run:* --release` or '
        + '`sigx prebuild --embed-bundle`. OTA updates (`sigx updates:publish`) do NOT carry them.',
      );
    } catch (err) {
      api.logger.warn(
        `[sigx] Could not inspect async chunks: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
      `[@sigx/lynx-plugin] device console log streaming → enabled`,
    );
  } else {
    api.logger.warn(
      `[@sigx/lynx-plugin] device console log streaming → disabled (install @sigx/lynx-dev-client as a devDependency of this app). rootPath=${api.context.rootPath}, cwd=${process.cwd()}`,
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
      api.logger.info('[@sigx/lynx-plugin] production observability → enabled');
    } else {
      api.logger.warn('[@sigx/lynx-plugin] logging.production is set but @sigx/lynx-observability is not installed — add it as a dependency.');
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
          // Build tier, as a plain boolean literal. Deliberately NOT an alias
          // of `__DEV__`: that define expands to a `process.env` expression
          // which THROWS in the Lynx background runtime, so app code can't
          // safely branch on it (see the note beside it in index.ts). This one
          // is resolved here in Node and folded, so `if (__DEV_BUILD__)` both
          // works at runtime and tree-shakes out of a release bundle.
          __DEV_BUILD__: JSON.stringify(process.env['NODE_ENV'] !== 'production'),
          // Whether stylesheet at-rules (`@media`, `@supports`) actually reach
          // this bundle's binary — the encoder path below is gated on
          // `enableCSSRule`, and the web target drops them regardless
          // (upstream `WebEncodePlugin`). Library code that would otherwise
          // have to *assume* an at-rule resolved can branch on this instead:
          // `@sigx/lynx-zero`'s `<ThemeProvider>` uses it to decide between the
          // CSS-resolved theme palette and the inline-custom-property fallback
          // (#985). Nothing here validates the engine version — a pre-4.0 host
          // still can't evaluate the rules it decodes.
          __SIGX_CSS_RULE__: JSON.stringify(cssRulesReachBinary(opts, isWeb)),
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

      // `resolve.extensions` only rewrites *extensionless* specifiers (app
      // source). Published `@sigx/lynx-*` dists import with explicit
      // extensions (`export … from './storage.js'`), which only
      // `resolve.extensionAlias` rewrites — so on the web bundle, prepend
      // `.web.js` there too, making a package's compiled `storage.web.js`
      // shim win over its `storage.js`. This is the per-package web-shim
      // mechanism (signalxjs/lynx#697). Merge ahead of rsbuild's
      // tsconfig-driven mapping (`.js → ['.js', '.ts', '.tsx']`) — never
      // clobber it, and fall back to the identity alias when absent.
      if (isWeb) {
        for (const [key, webExt] of [['.js', '.web.js'], ['.jsx', '.web.jsx']] as const) {
          const cur = chain.resolve.extensionAlias.get(key) as string[] | string | undefined;
          chain.resolve.extensionAlias.set(key, prependWebExtensionAlias(cur, key, webExt));
        }
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
      // SigxAsyncChunkPlugin – keep dynamic import() on the requireModuleAsync
      // path (#1015). Registered BEFORE LynxTemplatePlugin on purpose: it
      // captures `output.chunkFilename` in an `environment` tap, which has to
      // run before the template plugin's own tap replaces it.
      // ----------------------------------------------------------------
      if ((isLynx || isWeb) && templateMod) {
        chain
          .plugin(PLUGIN_ASYNC_CHUNK)
          .use(SigxAsyncChunkPlugin, [templateMod.LynxTemplatePlugin])
          .end();
      }

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
    // SigxPageConfigPlugin – merge page-config keys LynxTemplatePlugin
    // doesn't emit itself into the encoded template (#116). Always writes
    // the resolved boolean (not just true) so `false` is a real kill
    // switch that overrides any pre-existing value in the config.
    // ------------------------------------------------------------------
    if ((isLynx || isWeb) && templateMod) {
      chain
        .plugin(PLUGIN_PAGE_CONFIG)
        .use(SigxPageConfigPlugin, [
          templateMod.LynxTemplatePlugin,
          {
            enableCSSInlineVariables: opts.enableCSSInlineVariables ?? true,
            enableNewSticky: opts.enableNewSticky ?? false,
            enableElementApiNewRegistration:
              opts.enableElementApiNewRegistration ?? false,
            // Routes CSS encoding through the tasm CSSRuleParser, which is
            // what carries @media/@supports (ConditionRule) and @layer into
            // the binary — the legacy token path silently drops them (#951).
            // Needs @lynx-js/tasm >= 0.0.41 (template-webpack-plugin >= 0.14)
            // to have any effect. When true, the encoder also forces
            // enableCSSSelector + enableCSSInvalidation on.
            enableCSSRule: opts.enableCSSRule ?? true,
          },
        ])
        .end();
    }

    // ------------------------------------------------------------------
    // SigxMarkMainThreadPlugin – mark MT assets for LynxTemplatePlugin
    // ------------------------------------------------------------------
    if ((isLynx || isWeb) && mainThreadFilenames.length > 0) {
      chain
        .plugin(PLUGIN_MARK_MAIN_THREAD)
        .use(SigxMarkMainThreadPlugin, [mainThreadFilenames])
        .end();

      // Fail the build if any worklet reached BG without an MT registration.
      chain
        .plugin(PLUGIN_WORKLET_GUARD)
        .use(SigxWorkletGuardPlugin, [mainThreadFilenames])
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
          '[@sigx/lynx-plugin] web environment setup failed: the `web` ' +
            'environment requires `WebEncodePlugin` from ' +
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
        .options({ snapshots: opts.snapshots === true })
        .end();

    chain.module
      .rule('sigx-worklet-mt')
      .test(/\.[jt]sx?$/)
      .issuerLayer(LAYERS.MAIN_THREAD)
      .enforce('pre')
      .use('sigx-worklet-mt-loader')
        .loader(path.resolve(_dirname, './loaders/worklet-loader-mt'))
        .options({ snapshots: opts.snapshots === true })
        .end();

    // Every main-thread module has side effects, whatever its package says.
    //
    // A worklet reaches the MT layer as a bare `registerWorkletInternal(...)`
    // call at module scope — the BG layer keeps only a `{_wkltId}` placeholder,
    // so on this layer nothing *imports* a binding from the module the worklet
    // came from. That is indistinguishable, to the bundler, from dead code: a
    // package marked `sideEffects: false` gets its MT modules shaken out, the
    // registration never runs, and `runWorklet` later finds nothing under that
    // id. The failure is completely silent — worklets simply never fire, so
    // gestures don't respond, animations don't animate, and a navigation card
    // stays parked wherever its first mapper flush put it (#1021).
    //
    // Fixing the manifests instead would mean auditing every package that ever
    // gains a worklet, forever, and would still not cover an app's own
    // dependencies. `sideEffects` is a claim about *ES module semantics*, and
    // it is true for these packages on the background layer — it is only the
    // MT transform that turns them into registration modules. So the override
    // belongs here, scoped to the layer whose whole purpose is side effects.
    chain.module
      .rule('sigx-mt-side-effects')
      .issuerLayer(LAYERS.MAIN_THREAD)
      .set('sideEffects', true);

    // Disable IIFE wrapping – Lynx handles module scoping itself
    chain.output.set('iife', false);
  });
}
