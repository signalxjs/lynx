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

/**
 * Key under `lynx.__globalProps` where the native `FontScalePublisher`
 * (@sigx/lynx-core) writes the font-scale map before MT first paint.
 */
export const FONT_SCALE_GLOBAL_KEY = 'fontScale';

export interface RawFontScaleProps {
  /** Policy-clamped effective scale — what the engine applies. */
  scale?: number;
  /** Raw, unclamped OS value (Dynamic Type / Configuration.fontScale). */
  os?: number;
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

/**
 * Synchronously read the OS font scale from `lynx.__globalProps`. Returns
 * `null` when the publisher hasn't populated yet (early cold start) or when
 * running outside a Lynx host (web preview, SSR, tests). Callers should
 * treat `null` as "unknown — assume 1".
 *
 * `scale` is the policy-clamped effective value the engine applies to
 * font-size/line-height; `os` is the raw system setting (equal to `scale`
 * unless the app's `fontScale.min/max` config clamped it).
 *
 * Safe on both BG and MT threads — `__globalProps` is mirrored across both.
 */
export function readGlobalFontScale(): { scale: number; os: number } | null {
  const lynxObj: LynxGlobalLike | undefined = typeof lynx !== 'undefined'
    ? (lynx as unknown as LynxGlobalLike)
    : undefined;
  const raw = lynxObj?.__globalProps?.[FONT_SCALE_GLOBAL_KEY] as RawFontScaleProps | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const scale = raw.scale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return null;
  const os = typeof raw.os === 'number' && Number.isFinite(raw.os) && raw.os > 0 ? raw.os : scale;
  return { scale, os };
}
