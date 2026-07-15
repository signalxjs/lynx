/**
 * MT-layer rspack loader for the `'main thread'` worklet directive.
 *
 * Runs on every JS/TS file in the MT layer — no rule-level exclude.
 * Decides per-file what to emit based on directive presence and whether
 * the file is library code (`node_modules/` or `dist/`) or user code:
 *
 *   | Origin       | Directive? | Output                                         |
 *   |--------------|------------|------------------------------------------------|
 *   | user code    | no         | bootstrap preamble + side-effect imports       |
 *   |              |            |   (drops body — sigx's Lepus never executes    |
 *   |              |            |    React components; `entry-main.ts`'s         |
 *   |              |            |    `renderPage` builds a placeholder and ops   |
 *   |              |            |    arrive from BG via `sigxPatchUpdate`)       |
 *   | user code    | yes        | bootstrap preamble + side-effect imports       |
 *   |              |            |   + extracted `registerWorkletInternal(...)`   |
 *   | user .tsx/jsx| snapshots  | as above, PLUS extracted snapshot-template     |
 *   |              | flag on    |   registrations (`snapshotCreatorMap[...]`)    |
 *   |              |            |   bound to `globalThis.__sigxSnapshotInternal` |
 *   |              |            |   (#635 — component bodies still dropped; the |
 *   |              |            |   MT executes compiled templates, never        |
 *   |              |            |   arbitrary component code)                    |
 *   | library      | no         | source unchanged                               |
 *   |              |            |   (preserves `@sigx/lynx-runtime-main`'s MT    |
 *   |              |            |    globals — `processData`, `updateGlobalProps`,|
 *   |              |            |    `sigxRunOnMT` — and barrel re-exports that  |
 *   |              |            |    BG-side consumers like daisyui import by    |
 *   |              |            |    name; rspack shares module identity across  |
 *   |              |            |    BG/MT layers)                                |
 *   | library      | yes        | source unchanged + appended registrations      |
 *   |              |            |   (keeps named exports AND registers worklets) |
 *
 * Library files skip the bootstrap preamble — the user entry's
 * preamble has already pulled runtime-main in before any library code
 * evaluates.
 *
 * For files WITH a directive, the LEPUS transform's output is sliced
 * via `extractRegistrations` so only the `registerWorkletInternal(...)`
 * calls are kept. The `loadWorkletRuntime` import that upstream emits
 * is dropped — `registerWorkletInternal` is installed as a global by
 * `entry-main.ts`.
 *
 * Mirrors vue-lynx's `worklet-loader-mt.ts`, minus the `?vue` sub-module
 * branch (sigx has no Vue SFC pipeline) and minus the shared-imports path
 * (deferred to Phase 1c).
 */

import type { Rspack } from '@rsbuild/core';
import { transformReactLynxSync } from '@lynx-js/react/transform';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  detectSnapshotNamespace,
  extractLocalImports,
  extractRegistrations,
  extractSnapshotRegistrations,
  LIBRARY_PATH_RE,
  MT_DEFINES,
} from './worklet-utils.js';
import {
  JSXISH_EXT_RE,
  SNAPSHOT_INJECT,
  SNAPSHOT_RUNTIME_PKG,
  SNAPSHOT_UNSUPPORTED_RE,
  snapshotConfig,
} from './snapshot-config.js';

// Same idiomatic-barrel matching as the BG loader (see worklet-loader.ts:23
// for the full rationale). The LEPUS pass emits an `import { loadWorkletRuntime
// } from '<runtimePkg>'`, but `extractRegistrations` slices the LEPUS output
// down to `registerWorkletInternal(...)` calls only — the import is dropped
// before bundling — so the runtimePkg's actual exports don't need to include
// loadWorkletRuntime. What matters here is identifier tracking: aligning
// with '@sigx/lynx' means SWC follows `runOnBackground as s` through
// '@sigx/lynx' barrel imports just like on the BG side.
const RUNTIME_PKG = '@sigx/lynx';

/**
 * Prepended to every MT-layer file so webpack's dep graph guarantees the
 * bootstrap modules evaluate BEFORE any user code that calls
 * `registerWorkletInternal(...)`. Listing these as separate entries in
 * `entry.ts` doesn't suffice — rspack walks the chunk graph, which can
 * eval user code first when nothing else explicitly depends on bootstrap.
 *
 * Order matters: entry-main's module body sets globalThis.SystemInfo before
 * worklet-runtime's IIFE reads it.
 *
 * Paths are resolved to absolute file URIs at loader-init time so user apps
 * don't need to declare @lynx-js/react as a direct dep — pnpm hoists it into
 * our package's node_modules and we hand rspack the resolved path. We resolve
 * the package's `package.json` (always reachable, no exports-map games), read
 * the dist subpath relative to it. createRequire(import.meta.url) lets us
 * walk up from the loader's install location via Node's CJS resolver.
 */
const _req = createRequire(import.meta.url);

function resolvePackageSubpath(pkgName: string, subpath: string): string {
  const pkgJsonPath = _req.resolve(`${pkgName}/package.json`);
  return join(dirname(pkgJsonPath), subpath);
}

const ENTRY_MAIN_PATH = resolvePackageSubpath(
  '@sigx/lynx-runtime-main',
  'dist/entry-main.js',
);
const WORKLET_RUNTIME_PATH = resolvePackageSubpath(
  '@lynx-js/react',
  'runtime/worklet-runtime/main.js',
);
const INSTALL_HYBRID_PATH = resolvePackageSubpath(
  '@sigx/lynx-runtime-main',
  'dist/install-hybrid-worklet.js',
);

const BOOTSTRAP_PREAMBLE =
  `import ${JSON.stringify(ENTRY_MAIN_PATH)};\n`
  + `import ${JSON.stringify(WORKLET_RUNTIME_PATH)};\n`
  + `import ${JSON.stringify(INSTALL_HYBRID_PATH)};\n`;

// Cheap pre-filter to skip the SWC parse for files that obviously don't
// contain a worklet directive. A directive is always followed immediately
// by a statement terminator — either `;` or a newline (ASI). Requiring
// one of those after the closing quote rejects substrings inside
// single-line error strings like
// `"...inside 'main thread' functions..."` from `@sigx/lynx-runtime`'s
// dist, where the next char is a space then `functions`.
//
// This is not a parser. A truly adversarial input (e.g. the literal
// string `"'main thread';"`) can slip through, and SWC is the final
// arbiter — for such files it produces no registrations and the MT
// output reduces to the library branch's source pass-through (for
// library paths) or to the no-directive user branch's strip (for user
// paths). Either way: correct, just with the parse work done.
const DIRECTIVE_RE = /['"]main thread['"]\s*(?:;|\n)/;

// Library paths (`node_modules/` and any `dist/`) get the body-preserve
// branches above (LIBRARY_PATH_RE now lives in worklet-utils.ts, shared with
// the BG loader). Rspack shares module identity across BG/MT layers, so
// stripping the MT-side body of a library file would wipe its named
// exports for BG consumers too — daisyui couldn't resolve `useTabs` from
// lynx-navigation, runtime-main's MT globals would disappear, etc.

export default function workletLoaderMT(
  this: Rspack.LoaderContext,
  source: string,
): string {
  this.cacheable(true);

  const { snapshots = false } = (this.getOptions?.() ?? {}) as { snapshots?: boolean };
  const isLibrary = LIBRARY_PATH_RE.test(this.resourcePath);
  // Snapshot lowering: app/workspace-src JSX files only, minus constructs the
  // pass can't lower (see the BG loader — the gates MUST match or the two
  // layers' template sets desync).
  const wantSnapshot = snapshots && !isLibrary
    && JSXISH_EXT_RE.test(this.resourcePath)
    && !SNAPSHOT_UNSUPPORTED_RE.test(source);

  const localImports = extractLocalImports(source);

  if (!DIRECTIVE_RE.test(source) && !wantSnapshot) {
    if (isLibrary) {
      return source;
    }
    return BOOTSTRAP_PREAMBLE + localImports;
  }

  const filename = this.resourcePath;
  const transform = (withSnapshot: boolean) =>
    transformReactLynxSync(source, {
      pluginName: 'sigx:worklet-mt',
      filename,
      sourcemap: false,
      cssScope: false,
      shake: false,
      compat: false,
      refresh: false,
      // MT-side thread defines (see worklet-utils.ts). defineDCE runs before
      // the worklet pass, so registered worklet bodies keep only their
      // `__MAIN_THREAD__` branches. No-directive user files never reach this
      // transform — their bodies are dropped above, defines and all. Library
      // files are never folded (app/workspace-src scope), matching the BG side.
      defineDCE: isLibrary ? false : { define: MT_DEFINES },
      directiveDCE: false,
      // sigx owns dynamic import() handling (#599/#612 async chunks) — the
      // transform's lazy-bundle rewrite would inject a hardcoded
      // @lynx-js/react/internal import and consume the import() call.
      dynamicImport: false,
      // MUST mirror the BG loader's snapshot config exactly
      // (snapshot-config.ts) — template uniqIDs are content-hash-derived and
      // the BG references what this pass registers.
      snapshot: withSnapshot ? snapshotConfig('LEPUS', filename) : false,
      ...(withSnapshot ? { inject: SNAPSHOT_INJECT } : {}),
      worklet: { target: 'LEPUS', filename, runtimePkg: RUNTIME_PKG },
    });

  let result;
  let snapshotLowered = wantSnapshot;
  try {
    result = transform(wantSnapshot);
  } catch (e) {
    // WASM panic safety net — mirrors the BG loader so both layers degrade
    // the same file identically (no template-set desync).
    if (!wantSnapshot) throw e;
    this.emitWarning?.(new Error(
      `[sigx-worklet-mt] snapshot lowering failed for ${filename} — `
        + `falling back to the per-element path (${String(e).slice(0, 100)})`,
    ));
    snapshotLowered = false;
    result = transform(false);
  }

  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      this.emitError(new Error(`[sigx-worklet-mt] LEPUS transform: ${err.text}`));
    }
    return localImports;
  }

  const registrations = extractRegistrations(result.code);

  // Snapshot registrations (#635): slice the template id consts and lazy
  // `snapshotCreatorMap` assignments out of the LEPUS output and bind the
  // transform's namespace local to the `__sigxSnapshotInternal` global that
  // entry-main installs — the registrations then run without executing any
  // component code on the MT, in the static bundle and future HMR eval
  // realms alike.
  let snapshotRegistrations = '';
  if (snapshotLowered) {
    const ns = detectSnapshotNamespace(result.code, SNAPSHOT_RUNTIME_PKG);
    if (ns) {
      const extracted = extractSnapshotRegistrations(result.code, ns);
      if (extracted) {
        snapshotRegistrations = `const ${ns} = globalThis.__sigxSnapshotInternal;\n${extracted}`;
      }
    }
  }

  // Library files with a directive (e.g. lynx-navigation's `EdgeBackHandle.js`,
  // `navigator/core.js`): preserve the original source so its named exports
  // survive cross-layer module identity (BG-side consumers like daisyui
  // import them by name), and append the `registerWorkletInternal` calls so
  // the directives are still registered on the MT side. No bootstrap
  // preamble — user entry code's preamble has already pulled runtime-main
  // in before any library code is evaluated.
  if (isLibrary) {
    return registrations ? `${source}\n${registrations}` : source;
  }

  return BOOTSTRAP_PREAMBLE
    + [localImports, snapshotRegistrations, registrations].filter(Boolean).join('\n');
}
