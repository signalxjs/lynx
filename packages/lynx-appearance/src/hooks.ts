import { signal, type Computed, type PrimitiveSignal } from '@sigx/reactivity';
import { useAppearanceContext } from './injectable.js';
import { readGlobalColorScheme, readGlobalFontScale } from './globals.js';
import type { ColorScheme } from './types.js';

type ColorSchemeRead = PrimitiveSignal<ColorScheme> | Computed<ColorScheme>;
type FontScaleRead = PrimitiveSignal<number> | Computed<number>;

/**
 * BG-side reactive read of the current system color scheme. Returns the
 * live signal — components calling this re-render when the user flips dark
 * mode in system settings.
 *
 * If no `<AppearanceProvider>` is in scope, returns a fallback signal seeded
 * from `lynx.__globalProps` once at first call (still gives the correct
 * value on cold start; just doesn't update live). This lets ThemeProvider
 * use the hook even when its consumer hasn't mounted `<AppearanceProvider>`.
 */
export function useSystemColorScheme(): ColorSchemeRead {
  const ctx = useAppearanceContext();
  if (ctx) return ctx.colorScheme;
  return fallbackSignal();
}

/**
 * MT-thread synchronous read of the current system color scheme. For use
 * inside `'main thread'`-marked worklet bodies. Reads `lynx.__globalProps`
 * directly — no subscription, callers re-evaluate per worklet invocation.
 *
 * Returns `'light'` when the publisher hasn't populated yet (cold start before
 * first publish, or non-Lynx hosts).
 */
export function useSystemColorSchemeMT(): ColorScheme {
  return readGlobalColorScheme() ?? 'light';
}

/**
 * BG-side reactive read of the effective OS font scale (the policy-clamped
 * multiplier the engine applies to font-size/line-height). Returns the live
 * signal — components re-render when the user changes the system text size.
 *
 * The engine already scales all text automatically; use this to adapt
 * *around* larger text (swap layouts, hide decorations, size icons).
 *
 * If no `<AppearanceProvider>` is in scope, returns a fallback signal seeded
 * from `lynx.__globalProps` once at first call (correct on cold start; just
 * doesn't update live).
 */
export function useFontScale(): FontScaleRead {
  const ctx = useAppearanceContext();
  if (ctx) return ctx.fontScale;
  return fallbackScaleSignal();
}

/**
 * MT-thread synchronous read of the effective OS font scale. For use inside
 * `'main thread'`-marked worklet bodies. Reads `lynx.__globalProps` directly —
 * no subscription, callers re-evaluate per worklet invocation.
 *
 * Returns `1` when the publisher hasn't populated yet (cold start before
 * first publish, or non-Lynx hosts).
 */
export function useFontScaleMT(): number {
  return readGlobalFontScale()?.scale ?? 1;
}

let _fallback: PrimitiveSignal<ColorScheme> | undefined;
function fallbackSignal(): PrimitiveSignal<ColorScheme> {
  if (!_fallback) {
    _fallback = signal<ColorScheme>(readGlobalColorScheme() ?? 'light');
  }
  return _fallback;
}

let _fallbackScale: PrimitiveSignal<number> | undefined;
function fallbackScaleSignal(): PrimitiveSignal<number> {
  if (!_fallbackScale) {
    _fallbackScale = signal<number>(readGlobalFontScale()?.scale ?? 1);
  }
  return _fallbackScale;
}

// Re-export a typed PrimitiveSignal/Computed pair so consumers can write
// `useSystemColorScheme().value` without importing from @sigx/reactivity.
export type { PrimitiveSignal, Computed } from '@sigx/reactivity';
