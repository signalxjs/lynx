import type { Config } from 'tailwindcss';

/**
 * DaisyUI Lynx Tailwind Preset
 *
 * Maps DaisyUI semantic color tokens to CSS custom properties
 * defined in @sigx/lynx-daisyui/styles. Consumers add this
 * preset to their tailwind.config.ts so utilities like
 * `bg-primary` and `text-base-content` resolve to our tokens.
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

export const DaisyLynxPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: daisyColors,
    },
  },
};

/** Alias — preferred consumer name. */
export const daisyuiPreset = DaisyLynxPreset;
