/**
 * `@sigx/lynx-daisyui-zero` — daisyUI for lynx as DATA: the compiled
 * class-grammar CSS ships under `./css/*` (import
 * `@sigx/lynx-daisyui-zero/css/index.css` once, app-wide), and importing
 * THIS module seeds zero's theme registry with the skin's themes — the same
 * registry `@sigx/lynx-zero`'s ThemeProvider and themeController read, so
 * selection, pairing and follow-system all work with no further wiring.
 *
 * Seeding at module load is the design-system-package convention (the web
 * skins do the same); it is why this package declares `sideEffects`.
 */
import { registerTheme, registerTextRamp } from '@sigx/lynx-zero';
import { DAISY_CLASS_GRAMMAR_VERSION, DAISY_TEXT_RAMP, DAISY_THEMES } from './generated/theme-data.js';

for (const theme of DAISY_THEMES) {
    registerTheme(theme);
}
if (Object.keys(DAISY_TEXT_RAMP).length > 0) {
    registerTextRamp(DAISY_TEXT_RAMP);
}

export { DAISY_CLASS_GRAMMAR_VERSION, DAISY_TEXT_RAMP, DAISY_THEMES };
