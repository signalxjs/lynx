/**
 * BG-layer rspack loader for the `'main thread'` worklet directive.
 *
 * Delegates to upstream's `transformReactLynxSync` (a framework-agnostic SWC
 * worklet transform shared with vue-lynx and react-lynx — see
 * docs/mts-upstream-spike.md). With `target: 'JS'`, each `'main thread'`-marked
 * function is replaced by a `{ _wkltId, _c? }` placeholder object that the
 * sigx BG runtime ships through SET_WORKLET_EVENT to MT.
 *
 * Files without the directive are passed through unchanged. The MT side is
 * handled by the sibling `worklet-loader-mt.ts`.
 */

import type { Rspack } from '@rsbuild/core';
import { transformReactLynxSync } from '@lynx-js/react/transform';

// runtimePkg controls where SWC emits `import { transformToWorklet }` for the
// BG bundle (used when `runOnBackground(fn)` appears inline inside a
// `'main thread'` body). Point at @sigx/lynx-runtime — the BG runtime —
// because that's where transformToWorklet is exported. The MT loader uses
// @sigx/lynx-runtime-main; identifier matching for runOnMainThread /
// runOnBackground is by name and works regardless of source.
const RUNTIME_PKG = '@sigx/lynx-runtime';

// Cheap pre-filter to skip the SWC parse for files that obviously don't
// contain a worklet directive. A directive is always followed immediately
// by a statement terminator — either `;` or a newline (ASI). Requiring
// one of those after the closing quote rejects substrings inside
// single-line error strings like
// `"...inside 'main thread' functions..."` from `@sigx/lynx-runtime`'s
// dist, where the next char is a space then `functions`.
//
// This is not a parser. A truly adversarial input (e.g. the literal
// string `"'main thread';"`) can slip through, and the SWC transform
// is the final arbiter — for such files it produces no registrations
// and the BG output is identical to the no-directive path, just with
// the parse work done.
const DIRECTIVE_RE = /['"]main thread['"]\s*(?:;|\n)/;

export default function workletLoader(
  this: Rspack.LoaderContext,
  source: string,
): string {
  this.cacheable(true);

  if (!DIRECTIVE_RE.test(source)) {
    return source;
  }

  const filename = this.resourcePath;
  const result = transformReactLynxSync(source, {
    pluginName: 'sigx:worklet',
    filename,
    sourcemap: false,
    cssScope: false,
    shake: false,
    compat: false,
    refresh: false,
    defineDCE: false,
    directiveDCE: false,
    snapshot: false,
    worklet: { target: 'JS', filename, runtimePkg: RUNTIME_PKG },
  });

  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      this.emitError(new Error(`[sigx-worklet] JS transform: ${err.text}`));
    }
    return source;
  }

  return result.code;
}
