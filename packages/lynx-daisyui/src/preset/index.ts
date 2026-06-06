import type { Config } from 'tailwindcss';
import { zeroPreset } from '@sigx/lynx-zero/preset';

/**
 * DaisyUI Lynx Tailwind Preset.
 *
 * The substance lives in the design-system-neutral `@sigx/lynx-zero/preset`
 * (semantic color tokens incl. `*-soft` -> `var(--color-*)`, the `--text-*`
 * font-size ramp, and the Lynx-correct `flex-fill` utility); this preset is
 * daisy's composition of it, and the place daisy-specific Tailwind
 * extensions land if/when daisy needs any.
 */
export const DaisyLynxPreset: Partial<Config> = zeroPreset;

/** Alias - preferred consumer name. */
export const daisyuiPreset = DaisyLynxPreset;
