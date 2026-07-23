import type { ColorScheme } from './types.js';

/**
 * Key under `lynx.__globalProps` where the native publisher writes the
 * appearance map. Single string shared by iOS / Android publishers, the JS
 * reader, and tests.
 */
export const GLOBAL_PROPS_KEY = 'appearance';

export interface RawAppearanceProps {
  colorScheme?: ColorScheme;
}

interface LynxGlobalLike {
  __globalProps?: { [k: string]: unknown };
}

// Closure-injected identifier from
// `@lynx-js/runtime-wrapper-webpack-plugin`'s `__init_card_bundle__` wrapper;
// declared locally so the package doesn't need to depend on lynx-runtime-internal
// just for the ambient (same pattern as lynx-safe-area).
declare const lynx: unknown | undefined;

/**
 * Synchronously read the current system color scheme from
 * `lynx.__globalProps`. Returns `null` when the publisher hasn't populated
 * yet (early cold start) or when running outside a Lynx host (web preview,
 * SSR, tests). Callers should treat `null` as "unknown — fall back to your
 * default theme".
 *
 * Safe on both BG and MT threads — `__globalProps` is mirrored across both.
 */
export function readGlobalColorScheme(): ColorScheme | null {
  const lynxObj: LynxGlobalLike | undefined = typeof lynx !== 'undefined'
    ? (lynx as unknown as LynxGlobalLike)
    : undefined;
  const raw = lynxObj?.__globalProps?.[GLOBAL_PROPS_KEY] as RawAppearanceProps | undefined;
  if (!raw || typeof raw !== 'object') return null;
  return raw.colorScheme === 'dark' ? 'dark' : raw.colorScheme === 'light' ? 'light' : null;
}
