import { registerTheme, extendTheme } from '@sigx/lynx-daisyui';

/**
 * Demo of *runtime* custom themes — the kind a multi-tenant app fetches from
 * its server and registers at startup. They ship NO bundled CSS: their colors
 * are data, and `<ThemeProvider>` applies them as inline CSS custom
 * properties. `extendTheme` derives each from a built-in base, overriding just
 * the brand colors. Colors are hex — Lynx's CSS engine has no `oklch()`.
 *
 * Imported for side effects from `App.tsx` so the registry is seeded before
 * `<ThemeProvider>` mounts and before `listThemes()` drives the Settings
 * picker.
 */
registerTheme(extendTheme('daisy-light', {
    name: 'acme-light',
    pair: 'acme-dark',
    colors: {
        'primary': '#e11d48', 'primary-content': '#fff1f2',
        'secondary': '#7c3aed', 'accent': '#0891b2',
        'base-100': '#fff7f9', 'base-200': '#ffe9ef', 'base-300': '#ffd6e0',
        'base-content': '#3f1d2b',
    },
}));

registerTheme(extendTheme('daisy-dark', {
    name: 'acme-dark',
    pair: 'acme-light',
    colors: {
        'primary': '#fb7185', 'primary-content': '#2a0a12',
        'secondary': '#a78bfa', 'accent': '#22d3ee',
        'base-100': '#1a0d13', 'base-200': '#140a0f', 'base-300': '#0e060a',
        'base-content': '#ffe4ec',
    },
}));
