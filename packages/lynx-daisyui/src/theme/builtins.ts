/**
 * The six built-in daisy themes — pure palette *data*, registered into
 * `@sigx/lynx-zero`'s theme registry at module load (importing anything from
 * `@sigx/lynx-daisyui` seeds them, so `pickThemeFor()` / `followSystem` work
 * out of the box).
 *
 * Each ships `staticCss: true`: `scripts/gen-theme-css.mjs` generates a
 * `.daisy-<name> { --color-*: … }` CSS class per theme at build time so the
 * first frame paints correctly (the runtime `setProperty` path can't set
 * inheritable custom properties before descendants have painted).
 *
 * Colors are engine-safe strings — hex or `rgb()`. Lynx's CSS engine does not
 * parse `oklch()`, so convert before registering.
 */
import { completeTheme, registerTheme, type Theme, type ThemeInput } from '@sigx/lynx-zero/registry';

/**
 * Theme class applied to the provider's host view. The six color themes
 * get autocomplete; arbitrary strings are accepted for custom themes or
 * multi-class compositions like `'daisy-light daisy-rounded'`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types
export type DaisyTheme =
    | 'daisy-light'
    | 'daisy-dark'
    | 'daisy-cupcake'
    | 'daisy-emerald'
    | 'daisy-synthwave'
    | 'daisy-dracula'
    | (string & {});

// Shared status palette — identical across the original built-ins, hoisted to
// avoid repetition. (Themes are free to override any of these.)
const STATUS_LIGHT = {
  'info': '#00b4fa', 'info-content': '#000000',
  'success': '#00a96e', 'success-content': '#000000',
  'warning': '#ffc100', 'warning-content': '#000000',
  'error': '#ff676a', 'error-content': '#000000',
} as const;

/**
 * The built-in theme data, exported for `scripts/gen-theme-css.mjs` (which
 * emits the per-theme first-paint CSS classes from it at build time).
 * @internal
 */
const RAW_THEMES: readonly ThemeInput[] = [
  {
    name: 'daisy-light', variant: 'light', pair: 'daisy-dark', staticCss: true, softMix: 0.08,
    colors: {
      'primary': '#491dff', 'primary-content': '#d3dbff',
      'secondary': '#ff20cc', 'secondary-content': '#fff8fc',
      'accent': '#00cfbd', 'accent-content': '#00100d',
      'neutral': '#2b3440', 'neutral-content': '#d7dde4',
      'base-100': '#ffffff', 'base-200': '#f2f2f2', 'base-300': '#e5e6e6',
      'base-content': '#1f2937',
      ...STATUS_LIGHT,
    },
  },
  {
    name: 'daisy-cupcake', variant: 'light', pair: 'daisy-synthwave', staticCss: true, softMix: 0.08,
    colors: {
      'primary': '#65c3c8', 'primary-content': '#052124',
      'secondary': '#ef9fbc', 'secondary-content': '#2d0a16',
      'accent': '#eeaf3a', 'accent-content': '#2d1c00',
      'neutral': '#291334', 'neutral-content': '#f5f1f8',
      'base-100': '#faf7f5', 'base-200': '#efeae6', 'base-300': '#e7e2df',
      'base-content': '#291334',
      ...STATUS_LIGHT,
    },
  },
  {
    name: 'daisy-emerald', variant: 'light', pair: 'daisy-dracula', staticCss: true, softMix: 0.08,
    colors: {
      'primary': '#66cc8a', 'primary-content': '#06200f',
      'secondary': '#377cfb', 'secondary-content': '#02112d',
      'accent': '#f68067', 'accent-content': '#2d0a02',
      'neutral': '#333c4d', 'neutral-content': '#e9eaed',
      'base-100': '#ffffff', 'base-200': '#f3f4f6', 'base-300': '#e5e7eb',
      'base-content': '#333c4d',
      'info': '#1c92f2', 'info-content': '#000a14',
      'success': '#00a96e', 'success-content': '#000a05',
      'warning': '#ff9900', 'warning-content': '#261600',
      'error': '#ff5724', 'error-content': '#000000',
    },
  },
  {
    name: 'daisy-dark', variant: 'dark', pair: 'daisy-light', staticCss: true, softMix: 0.08,
    colors: {
      'primary': '#7582ff', 'primary-content': '#050617',
      'secondary': '#ff71cf', 'secondary-content': '#190211',
      'accent': '#00e7d0', 'accent-content': '#001210',
      'neutral': '#2a323c', 'neutral-content': '#a6adbb',
      'base-100': '#1d232a', 'base-200': '#191e24', 'base-300': '#343b46',
      'base-content': '#a6adbb',
      ...STATUS_LIGHT,
    },
  },
  {
    name: 'daisy-synthwave', variant: 'dark', pair: 'daisy-cupcake', staticCss: true, softMix: 0.08,
    colors: {
      'primary': '#e779c1', 'primary-content': '#2a0a1f',
      'secondary': '#58c7f3', 'secondary-content': '#02141d',
      'accent': '#f3cc30', 'accent-content': '#2a1f00',
      'neutral': '#20134e', 'neutral-content': '#e3e0f5',
      'base-100': '#2d1b69', 'base-200': '#261159', 'base-300': '#1f0f4a',
      'base-content': '#f9f7fd',
      'info': '#53c0f3', 'info-content': '#02151e',
      'success': '#71ead2', 'success-content': '#002721',
      'warning': '#f3cc30', 'warning-content': '#2a1f00',
      'error': '#e24056', 'error-content': '#ffffff',
    },
  },
  {
    name: 'daisy-dracula', variant: 'dark', pair: 'daisy-emerald', staticCss: true, softMix: 0.08,
    colors: {
      'primary': '#ff79c6', 'primary-content': '#2d0414',
      'secondary': '#bd93f9', 'secondary-content': '#160226',
      'accent': '#50fa7b', 'accent-content': '#002a0e',
      'neutral': '#414558', 'neutral-content': '#f8f8f2',
      'base-100': '#282a36', 'base-200': '#21222c', 'base-300': '#181920',
      'base-content': '#f8f8f2',
      'info': '#8be9fd', 'info-content': '#002a31',
      'success': '#50fa7b', 'success-content': '#002a0e',
      'warning': '#f1fa8c', 'warning-content': '#2a2900',
      'error': '#ff5555', 'error-content': '#2a0000',
    },
  },
];

// Seed at module load. Registration order matters: daisy-light / daisy-dark
// are first of their variants, so they are the follow-system defaults.
export const DAISY_BUILTIN_THEMES: readonly Theme[] = RAW_THEMES.map(completeTheme);

for (const theme of DAISY_BUILTIN_THEMES) registerTheme(theme);
