import { defineInjectable } from '@sigx/lynx';
import type { PrimitiveSignal } from '@sigx/reactivity';
import type { ColorScheme } from './types.js';

/** DI shape exposed by `<AppearanceProvider>`. */
export interface AppearanceContextValue {
  /** BG-side reactive color scheme. Re-renders consumers on system flip. */
  readonly colorScheme: PrimitiveSignal<ColorScheme>;
  /**
   * BG-side reactive effective font scale (policy-clamped OS text-size
   * multiplier the engine applies). Re-renders consumers when the user
   * changes the system text size.
   */
  readonly fontScale: PrimitiveSignal<number>;
}

/**
 * The DI handle for the appearance context.
 *
 * Factory returns `null` so consumers outside a provider get a clear signal
 * (vs. a phantom `'light'` signal that silently never updates). Hooks in
 * `./hooks.ts` wrap this with the null-check + fallback signal.
 */
export const useAppearanceContext = defineInjectable<AppearanceContextValue | null>(
  () => null,
);
