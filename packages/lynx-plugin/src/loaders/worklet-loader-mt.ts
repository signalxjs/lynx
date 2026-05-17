/**
 * MT-layer rspack loader for the `'main thread'` worklet directive.
 *
 * Runs on every file the rule scope reaches (user code + the worklet-
 * shipping `@sigx/*` packages — `lynx-motion`, `lynx-navigation`,
 * `lynx-gestures`. Other library code is excluded at the rule level so
 * `@sigx/lynx-runtime-main` keeps its MT globals — see `entry.ts`).
 * For each file:
 *   1. Extract local + `@sigx/*` imports → side-effect-only imports so
 *      webpack still walks the dep graph (so files with worklets get
 *      reached) without demanding named exports that the body-stripped
 *      MT version of a sibling file won't provide.
 *   2. If the file has no `'main thread'` directive, return only those
 *      imports (drops user component code from the MT bundle — sigx's
 *      Lepus does not execute React components; see `entry-main.ts`:
 *      `renderPage` builds a single placeholder, all UI ops arrive from
 *      BG via `sigxPatchUpdate`).
 *   3. Otherwise call upstream's `transformReactLynxSync` with `target: 'LEPUS'`
 *      and slice out only the `registerWorkletInternal(...)` calls via
 *      `extractRegistrations`. Combine: `[localImports, registrations]`.
 *
 * The `loadWorkletRuntime` import that upstream's LEPUS output emits is
 * dropped — `extractRegistrations` only keeps the registration calls, and
 * `registerWorkletInternal` is installed as a global by `entry-main.ts`.
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

// Match `'main thread';` or `"main thread";` only at statement position —
// i.e. with a `;` directly after the closing quote. This is the JS form a
// worklet directive always takes; library code that mentions "main thread"
// inside an error message or doc comment (e.g.
// `@sigx/lynx-runtime/dist/index.js`'s runOnBackground error string) won't
// match because the next char there is a space, not `;`.
const DIRECTIVE_RE = /['"]main thread['"]\s*;/;

// Inside the worklet rule scope we see two kinds of files:
//   - User code (e.g. the showcase's `src/`): strip body for files without
//     a directive; sigx's Lepus doesn't execute React components, so
//     bundle-size-wise there's no reason to ship them. Top-level side
//     effects of user code are unpredictable enough to be worth skipping.
//   - Worklet-shipping `@sigx/*` libraries (motion / navigation / gestures):
//     these are opted in for their `'main thread'` directives, but their
//     non-directive files (barrel `index.js`, helper modules) still export
//     named symbols (e.g. `useTabs`, `useScreenChrome`) that downstream
//     packages like `@sigx/lynx-daisyui` import on the BG side. Rspack
//     in this version shares module identity across the BG/MT layers, so
//     stripping the MT-side body wipes those exports for both layers and
//     breaks resolution. Pass library bodies through verbatim — their
//     top-level code (component factories, injection-key declarations) is
//     side-effect-free in practice.
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
