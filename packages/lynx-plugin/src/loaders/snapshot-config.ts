/**
 * Shared snapshot-transform configuration (#635, phase 4b of #620).
 *
 * BOTH worklet loaders must build their `snapshot` options from this module:
 * template uniqIDs are content-hash-derived per (filename, source), and the
 * two layer transforms run independently — any config asymmetry between them
 * desyncs the ids the BG references from the ids the MT registers.
 */

import type { JsxTransformerConfig, InjectVisitorConfig } from '@lynx-js/react/transform';

/**
 * Where the emitted `import * as <ns> from '<runtimePkg>'` points. The BG
 * bundle imports it for real (registrations give the jsx wrapper its
 * template registry); the MT loader rewrites the namespace to the
 * `globalThis.__sigxSnapshotInternal` global installed by entry-main, so the
 * extracted registrations also work inside future HMR eval realms.
 */
export const SNAPSHOT_RUNTIME_PKG = '@sigx/lynx/internal';

/** Files that can contain JSX — the snapshot trigger beyond directives/defines. */
export const JSXISH_EXT_RE = /\.[jt]sx$/;

export function snapshotConfig(
  target: 'LEPUS' | 'JS',
  filename: string,
): JsxTransformerConfig {
  return {
    preserveJsx: false,
    runtimePkg: SNAPSHOT_RUNTIME_PKG,
    jsxImportSource: '@sigx/lynx',
    filename,
    target,
  };
}

/**
 * `createSnapshot`'s `entryName` argument in emitted registrations is the
 * free identifier `globDynamicComponentEntry` (a ReactLynx dynamic-component
 * concept sigx doesn't have; the contract module ignores it). Inject a
 * harmless literal so the identifier never dangles.
 */
export const SNAPSHOT_INJECT: InjectVisitorConfig = {
  inject: { globDynamicComponentEntry: ['expr', "'__sigx__'"] },
};

/**
 * JSX the snapshot pass cannot lower — currently sigx's `use:*` directive
 * attributes (`<view use:show={…}>`), which panic the upstream WASM
 * transform (`RuntimeError: unreachable`); `main-thread:*` namespaces are
 * fine. Used as a cheap pre-filter so known-bad files skip the snapshot pass
 * without paying a panic+retry; the try/catch retry in the loaders remains
 * the safety net for anything this regex misses.
 */
export const SNAPSHOT_UNSUPPORTED_RE =
  // - `use:*` directive attributes panic the upstream WASM pass;
  // - raw <list> JSX compiles to snapshotCreateList, which the MT runtime
  //   rejects until list templates land (#620 phase 5) — such files keep the
  //   per-element path wholesale. (List usage through @sigx/lynx-list is a
  //   library dist and never reaches the snapshot pass.)
  /\buse:[A-Za-z_$][\w$]*\s*=|<list[\s>/]/;
