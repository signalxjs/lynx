/**
 * MT-layer rspack loader for the `'main thread'` worklet directive.
 *
 * Runs on every file in the MT bundle. For each file:
 *   1. Extract local relative-path imports → side-effect-only imports so
 *      webpack still walks the dep graph to files that contain worklets.
 *   2. If the file has no `'main thread'` directive, return only those
 *      imports (drops user component code from the MT bundle — Lepus must
 *      not execute it).
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

export default function workletLoaderMT(
  this: Rspack.LoaderContext,
  source: string,
): string {
  this.cacheable(true);

  const localImports = extractLocalImports(source);

  if (!source.includes('\'main thread\'') && !source.includes('"main thread"')) {
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
  return BOOTSTRAP_PREAMBLE + [localImports, registrations].filter(Boolean).join('\n');
}
