// @sigx/lynx-zero — design-system-neutral UI foundation on the zero contract
// (signalxjs/lynx#1029). The pre-contract package lives on as
// @sigx/lynx-zero-legacy while this stack is built out.

// ── The contract ─────────────────────────────────────────────────────────
// @sigx/zero's portable contract verbatim (vocabularies, token names, the
// class grammar, variantAttrs) plus the two lynx seams: partBag (one part
// descriptor → class list + data-* attrs) and partA11y (the five-prop
// native accessibility mapping).
export * from './contract/index.js';

// ── The theme engine ─────────────────────────────────────────────────────
// Selection + follow-system + font scale. Theme VALUES live in the skin's
// compiled `.zx-root` / `.zx-theme-<name>` CSS; metadata in zero's registry.
export type { ThemeInfo, ThemeSource } from './theme/registry-bridge.js';
export {
    getTheme,
    listThemes,
    pairOf,
    pickThemeFor,
    registerTheme,
    registerThemes,
} from './theme/registry-bridge.js';
export type { ThemeController, ThemeName, ThemeState } from './theme/theme-state.js';
export { makeThemeController, normalizeFontScale, themeController } from './theme/theme-state.js';
export { registerTextRamp, textRampVars } from './theme/text-ramp.js';
export type { ThemeProviderProps } from './theme/ThemeProvider.js';
export { ThemeProvider, useTheme } from './theme/ThemeProvider.js';

// ── Layout primitives (lynx-only concerns; ported from legacy) ───────────
export { Row } from './layout/Row.js';
export { Col } from './layout/Col.js';
export { Center } from './layout/Center.js';
export { Spacer } from './layout/Spacer.js';
export { ScrollView } from './layout/ScrollView.js';
export type { BoxProps, SpacingValue } from './shared/styles.js';
export { resolveBoxStyle, resolveSpacing } from './shared/styles.js';
export type { Responsive } from './shared/responsive.js';
export { resolveResponsive } from './shared/responsive.js';
