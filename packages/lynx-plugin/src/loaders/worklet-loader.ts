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

export default function workletLoader(
  this: Rspack.LoaderContext,
  source: string,
): string {
  this.cacheable(true);

  if (!source.includes('\'main thread\'') && !source.includes('"main thread"')) {
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
