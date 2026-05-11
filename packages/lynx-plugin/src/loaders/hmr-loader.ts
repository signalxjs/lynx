/**
 * Rspack loader that injects HMR self-acceptance into component files.
 *
 * For every file that contains a `component(` or `component<` call, the
 * loader prepends:
 *   1. An import of `__registerComponentPlugin` from `@sigx/lynx` — this
 *      is the *same* bundle the app uses, so the plugin array is shared.
 *   2. An import of `initHMR` + `registerHMRModule` from `@sigx/lynx-runtime/hmr`.
 *   3. Calls to wire them up: `initHMR(__registerComponentPlugin)` (idempotent)
 *      and `registerHMRModule(moduleId)`.
 *   4. (If `signal` is imported) A wrapper that preserves signal objects
 *      across HMR cycles via `module.hot.data`, so module-level reactive
 *      state (e.g., a route signal) doesn't reset and cause structural tree
 *      mutations that crash the Lynx native engine.
 *
 * And appends `module.hot.accept()` + a dispose handler that snapshots
 * preserved signals into `module.hot.data` for the next execution.
 *
 * On re-execution the HMR runtime patches existing component instances
 * in-place — only property-level ops are emitted, avoiding the structural
 * tree mutations that crash Lynx's native engine.
 */

import type { Rspack } from '@rsbuild/core';

// Matches `component(` or `component<`
const COMPONENT_RE = /\bcomponent\s*[<(]/;

// Matches an import statement from @sigx/lynx that destructures `signal`.
// Captures: (1) before-signal names, (2) after-signal names, (3) quote char
// e.g.  import { signal, component } from '@sigx/lynx';
//          group 1: ""   group 2: ", component "  group 3: "'"
const SIGNAL_IMPORT_RE =
  /import\s*\{([^}]*)\bsignal\b([^}]*)\}\s*from\s*(['"])@sigx\/lynx\3/;

export default function hmrLoader(
  this: Rspack.LoaderContext,
  source: string,
): string {
  this.cacheable(false);

  if (!COMPONENT_RE.test(source)) {
    return source;
  }

  const moduleId = this.resourcePath
    .replace(/\\/g, '/')
    .replace(/\.(tsx?|jsx)$/, '');

  // Check if the file imports `signal` from @sigx/lynx
  const signalImportMatch = source.match(SIGNAL_IMPORT_RE);
  const hasSignalImport = !!signalImportMatch;

  let transformedSource = source;

  if (hasSignalImport) {
    // Rename `signal` → `__origSignal` in the import statement so we can
    // shadow it with a preserving wrapper.  All call-sites automatically
    // use the wrapper because the local binding name stays `signal`.
    transformedSource = source.replace(
      SIGNAL_IMPORT_RE,
      (_match, before, after, quote) =>
        `import {${before}signal as __origSignal${after}} from ${quote}@sigx/lynx${quote}`,
    );
  }

  const header: string[] = [
    `import { __registerComponentPlugin } from '@sigx/lynx';`,
    `import { initHMR, registerHMRModule } from '@sigx/lynx-runtime/hmr';`,
    `initHMR(__registerComponentPlugin);`,
    `registerHMRModule(${JSON.stringify(moduleId)});`,
  ];

  if (hasSignalImport) {
    // Inject a `signal` wrapper that returns the cached signal object from
    // the previous HMR cycle when one exists, or delegates to the real
    // `signal()` for new signals.  This preserves module-level reactive
    // state (and component-level state inside setup — matching React Fast
    // Refresh behaviour where hooks state is preserved across HMR).
    header.push(
      `var __hmrSigPrev = (typeof module !== 'undefined' && module.hot && module.hot.data && module.hot.data.__hmrSigs) || {};`,
      `var __hmrSigStore = {};`,
      `var __hmrSigIdx = 0;`,
      `function signal() {`,
      `  var k = 's' + __hmrSigIdx++;`,
      `  if (k in __hmrSigPrev) { __hmrSigStore[k] = __hmrSigPrev[k]; return __hmrSigPrev[k]; }`,
      `  var s = __origSignal.apply(null, arguments);`,
      `  __hmrSigStore[k] = s;`,
      `  return s;`,
      `}`,
    );
  }

  header.push('');

  const footer: string[] = [''];

  if (hasSignalImport) {
    footer.push(
      `if (typeof module !== 'undefined' && module.hot) {`,
      `  module.hot.dispose(function(data) { data.__hmrSigs = __hmrSigStore; });`,
      `  module.hot.accept();`,
      `}`,
    );
  } else {
    footer.push(
      `if (typeof module !== 'undefined' && module.hot) { module.hot.accept(); }`,
    );
  }

  return header.join('\n') + transformedSource + footer.join('\n');
}
