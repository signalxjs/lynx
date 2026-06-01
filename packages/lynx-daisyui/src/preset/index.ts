import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

/**
 * DaisyUI Lynx Tailwind Preset
 *
 * Maps DaisyUI semantic color tokens to CSS custom properties
 * defined in @sigx/lynx-daisyui/styles. Consumers add this
 * preset to their tailwind.config.ts so utilities like
 * `bg-primary` and `text-base-content` resolve to our tokens.
 *
 * Also ships a `flex-fill` utility — the Lynx-correct "fill remaining
 * space" class. Why this is in our preset rather than baked into Lynx's
 * own tailwind preset: in Lynx (like React Native) `flex: 1` shorthand
 * expands to `flex: 1 1 auto`, where `flexBasis: 'auto'` sizes the box
 * to its content first, collapsing the layout chain. The browser-CSS
 * intuition that `flex-1` = "fill remaining space" is wrong here, and
 * Tailwind's own `flex-1` class expands to the same broken shorthand.
 * `flex-fill` writes the long-form properties directly so the result
 * actually fills.
 */
const daisyColors: Record<string, string> = {
  'primary': 'var(--color-primary)',
  'primary-content': 'var(--color-primary-content)',
  'secondary': 'var(--color-secondary)',
  'secondary-content': 'var(--color-secondary-content)',
  'accent': 'var(--color-accent)',
  'accent-content': 'var(--color-accent-content)',
  'neutral': 'var(--color-neutral)',
  'neutral-content': 'var(--color-neutral-content)',
  'base-100': 'var(--color-base-100)',
  'base-200': 'var(--color-base-200)',
  'base-300': 'var(--color-base-300)',
  'base-content': 'var(--color-base-content)',
  'info': 'var(--color-info)',
  'info-content': 'var(--color-info-content)',
  'success': 'var(--color-success)',
  'success-content': 'var(--color-success-content)',
  'warning': 'var(--color-warning)',
  'warning-content': 'var(--color-warning-content)',
  'error': 'var(--color-error)',
  'error-content': 'var(--color-error-content)',
};

/**
 * Text ramp → token map. Re-points Tailwind's `text-xs`…`text-3xl` font-size
 * utilities at the daisy `--text-*` custom properties (defaults in
 * `styles/themes/tokens.css`, multiplied app-wide by the controller's
 * `fontScale`). Symmetric with `daisyColors`: a single source of truth. Merged
 * via `theme.extend.fontSize`, so the larger Tailwind keys (`text-4xl`+) keep
 * their rem defaults.
 */
const daisyFontSizes: Record<string, string> = {
  'xs': 'var(--text-xs)',
  'sm': 'var(--text-sm)',
  'base': 'var(--text-base)',
  'lg': 'var(--text-lg)',
  'xl': 'var(--text-xl)',
  '2xl': 'var(--text-2xl)',
  '3xl': 'var(--text-3xl)',
};

const lynxLayoutPlugin = plugin(({ addUtilities }) => {
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

export const DaisyLynxPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: daisyColors,
      fontSize: daisyFontSizes,
    },
  },
  plugins: [lynxLayoutPlugin],
};

/** Alias — preferred consumer name. */
export const daisyuiPreset = DaisyLynxPreset;
