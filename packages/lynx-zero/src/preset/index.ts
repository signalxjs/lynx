import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { COLOR_VARIANT_LIST } from '../contract.js';

/**
 * The design-system-neutral Tailwind preset pieces — the parts of a DS preset
 * that are really the *contract*, not the design system:
 *
 *   • `contractColors`: every semantic color token (incl. the `*-soft`
 *     tints) → `var(--color-*)`, so utilities like `bg-primary` and
 *     `text-base-content` resolve against the active theme of whichever
 *     design system is mounted.
 *   • `contractFontSizes`: re-points Tailwind's `text-xs`…`text-3xl`
 *     font-size utilities at the shared `--text-*` ramp (defaults in
 *     `styles/tokens.css`, multiplied app-wide by the theme controller's
 *     `fontScale`). Merged via `theme.extend.fontSize`, so larger Tailwind
 *     keys (`text-4xl`+) keep their rem defaults.
 *   • `lynxLayoutPlugin`: ships `flex-fill` — the Lynx-correct "fill
 *     remaining space" utility. In Lynx (like React Native) the `flex: 1`
 *     shorthand expands to `flex: 1 1 auto`, where `flexBasis: 'auto'` sizes
 *     the box to its content first, collapsing the layout chain; Tailwind's
 *     own `flex-1` expands to the same broken shorthand. `flex-fill` writes
 *     the long-form properties so the result actually fills.
 *
 * Design-system presets compose these (`@sigx/lynx-daisyui/preset`,
 * `@sigx/lynx-heroui/preset`) and layer any DS-specific extensions on top;
 * apps normally consume the DS preset, not this one directly.
 */

export const contractColors: Record<string, string> = Object.fromEntries([
  ...COLOR_VARIANT_LIST.flatMap((v) => [
    [v, `var(--color-${v})`],
    [`${v}-content`, `var(--color-${v}-content)`],
    [`${v}-soft`, `var(--color-${v}-soft)`],
  ]),
  ['base-100', 'var(--color-base-100)'],
  ['base-200', 'var(--color-base-200)'],
  ['base-300', 'var(--color-base-300)'],
  ['base-content', 'var(--color-base-content)'],
]);

export const contractFontSizes: Record<string, string> = {
  'xs': 'var(--text-xs)',
  'sm': 'var(--text-sm)',
  'base': 'var(--text-base)',
  'lg': 'var(--text-lg)',
  'xl': 'var(--text-xl)',
  '2xl': 'var(--text-2xl)',
  '3xl': 'var(--text-3xl)',
};

export const lynxLayoutPlugin = plugin(({ addUtilities }) => {
  addUtilities({
    // Long-form flex-fill — the Lynx-correct "take remaining space along
    // the main axis" utility. Default flex direction column; consumers
    // who want a horizontal fill compose with `flex-row` on the parent.
    '.flex-fill': {
      flexGrow: '1',
      flexShrink: '1',
      flexBasis: '0',
      minHeight: '0',
      display: 'flex',
      flexDirection: 'column',
    },
  });
});

/** The composed neutral preset — what DS presets spread. */
export const zeroPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: contractColors,
      fontSize: contractFontSizes,
    },
  },
  plugins: [lynxLayoutPlugin],
};
