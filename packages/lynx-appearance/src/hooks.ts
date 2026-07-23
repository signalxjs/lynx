import { signal, type Computed, type PrimitiveSignal } from '@sigx/reactivity';
import { useAppearanceContext } from './injectable.js';
import { readGlobalColorScheme } from './globals.js';
import type { ColorScheme } from './types.js';

type ColorSchemeRead = PrimitiveSignal<ColorScheme> | Computed<ColorScheme>;

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

// The OS font-scale reads (`useFontScale` / `useFontScaleMT` /
// `readGlobalFontScale`) live in `@sigx/lynx-core` — core owns the native
// FontScalePublisher, and packages that can't depend on this one (e.g.
// `@sigx/lynx-markdown`) need them too. Re-exported from ./index.ts; no
// provider required (the scale is global, not scoped).

let _fallback: PrimitiveSignal<ColorScheme> | undefined;
function fallbackSignal(): PrimitiveSignal<ColorScheme> {
  if (!_fallback) {
    _fallback = signal<ColorScheme>(readGlobalColorScheme() ?? 'light');
  }
  return _fallback;
}

// Re-export a typed PrimitiveSignal/Computed pair so consumers can write
// `useSystemColorScheme().value` without importing from @sigx/reactivity.
export type { PrimitiveSignal, Computed } from '@sigx/reactivity';
