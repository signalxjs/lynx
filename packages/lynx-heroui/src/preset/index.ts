import type { Config } from 'tailwindcss';
import { zeroPreset } from '@sigx/lynx-zero/preset';

/**
 * HeroUI Lynx Tailwind Preset.
 *
 * The substance lives in the design-system-neutral `@sigx/lynx-zero/preset`
 * (semantic color tokens incl. `*-soft` → `var(--color-*)`, the `--text-*`
 * font-size ramp, and the Lynx-correct `flex-fill` utility); this preset is
 * hero's composition of it, and the place hero-specific Tailwind extensions
 * land if/when hero needs any.
 */
export const HeroLynxPreset: Partial<Config> = zeroPreset;

/** Alias — preferred consumer name. */
export const herouiPreset = HeroLynxPreset;
