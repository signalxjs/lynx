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
import { extractLocalImports, extractRegistrations } from './worklet-utils.js';

const RUNTIME_PKG = '@sigx/lynx-runtime-main';

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
// branches above. Rspack shares module identity across BG/MT layers, so
// stripping the MT-side body of a library file would wipe its named
// exports for BG consumers too — daisyui couldn't resolve `useTabs` from
// lynx-navigation, runtime-main's MT globals would disappear, etc.
const LIBRARY_PATH_RE = /[\\/](?:node_modules|dist)[\\/]/;

export default function workletLoaderMT(
  this: Rspack.LoaderContext,
  source: string,
): string {
  this.cacheable(true);

  const localImports = extractLocalImports(source);

  if (!DIRECTIVE_RE.test(source)) {
    if (LIBRARY_PATH_RE.test(this.resourcePath)) {
      return source;
    }
    return BOOTSTRAP_PREAMBLE + localImports;
  }

  const filename = this.resourcePath;
  const result = transformReactLynxSync(source, {
    pluginName: 'sigx:worklet-mt',
    filename,
    sourcemap: false,
    cssScope: false,
    shake: false,
    compat: false,
    refresh: false,
    defineDCE: false,
    directiveDCE: false,
    snapshot: false,
    worklet: { target: 'LEPUS', filename, runtimePkg: RUNTIME_PKG },
  });

  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      this.emitError(new Error(`[sigx-worklet-mt] LEPUS transform: ${err.text}`));
    }
    return localImports;
  }

  const registrations = extractRegistrations(result.code);

  // Library files with a directive (e.g. lynx-navigation's `EdgeBackHandle.js`,
  // `navigator/core.js`): preserve the original source so its named exports
  // survive cross-layer module identity (BG-side consumers like daisyui
  // import them by name), and append the `registerWorkletInternal` calls so
  // the directives are still registered on the MT side. No bootstrap
  // preamble — user entry code's preamble has already pulled runtime-main
  // in before any library code is evaluated.
  if (LIBRARY_PATH_RE.test(this.resourcePath)) {
    return registrations ? `${source}\n${registrations}` : source;
  }

  return BOOTSTRAP_PREAMBLE + [localImports, registrations].filter(Boolean).join('\n');
}
