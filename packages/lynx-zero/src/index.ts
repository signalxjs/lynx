// @sigx/lynx-zero — design-system-neutral UI foundation.
//
// Holds what every design-system package (@sigx/lynx-daisyui,
// @sigx/lynx-heroui, …) shares: the props/token contract, the theme engine,
// layout primitives, style utilities and press-feedback defaults
// (see signalxjs/lynx#219).

// The shared contract: scales, semantic colors, prop fragments,
// token-name conventions.
export type {
  SizeScale,
  ColorVariant,
  ColorToken,
  CoreColorToken,
  SoftColorToken,
  BackgroundValue,
  WithClass,
  WithDisabled,
  WithColor,
  WithSize,
  PressEvent,
} from './contract.js';
export { resolveColorToken, COLOR_VARIANT_LIST } from './contract.js';

// Box-model style helpers.
export type { SpacingValue, BoxProps } from './shared/styles.js';
export { resolveSpacing, resolveBoxStyle } from './shared/styles.js';

// Press-feedback defaults for interactive components.
export { PRESSED_SCALE, PRESSED_OPACITY } from './shared/press.js';

// Headless tabs selection — shared behavior behind every DS's Tabs/Tab.
export { useTabsSelection, provideTabsSelection } from './shared/tabs-selection.js';
export type { TabsSelection } from './shared/tabs-selection.js';

// Theme engine — registry mechanism, provider, headless controller. Theme
// *data* (palettes, generated first-paint CSS classes) lives in each
// design-system package, which seeds the registry at module load.
export {
  ThemeProvider,
  useTheme,
  listThemes,
  registerTheme,
  extendTheme,
  pickThemeFor,
  pairOf,
  variantOf,
  colorsOf,
  radiusOf,
  sizesOf,
} from './theme/ThemeProvider.js';
export type {
  ThemeName,
  ThemeController,
  ThemeProviderProps,
  Theme,
  ThemePalette,
  ThemeRadius,
  ThemeSizes,
  ThemeVariant,
} from './theme/ThemeProvider.js';
// Palette completion (soft tints) + the JS-side color mixer behind it.
export { completeTheme } from './theme/registry.js';
export type { ThemeInput, ThemePaletteInput } from './theme/registry.js';
export { mixColors } from './theme/color-mix.js';
// Headless theme handle: import and call from anywhere — stores, services,
// effects, app-boot — with no `<ThemeProvider>` ancestor required.
export { themeController } from './theme/theme-state.js';
export { StatusBarSync } from './theme/StatusBarSync.js';
export type { StatusBarSyncProps } from './theme/StatusBarSync.js';
// Per-screen theming (`useScreenTheme`) is deliberately NOT re-exported here:
// it statically imports the optional `@sigx/lynx-navigation` peer, and a
// barrel re-export would force that resolution onto every consumer. Import it
// from the subpath instead: `@sigx/lynx-zero/screen-theme`.

// Layout primitives — design-system-neutral structure (flex containers,
// spacing, scrolling); no design-system class names involved.
export { Row } from './layout/Row.js';
export type { RowProps } from './layout/Row.js';
export { Col } from './layout/Col.js';
export type { ColProps } from './layout/Col.js';
export { Center } from './layout/Center.js';
export type { CenterProps } from './layout/Center.js';
export { Spacer } from './layout/Spacer.js';
export type { SpacerProps } from './layout/Spacer.js';
export { ScrollView } from './layout/ScrollView.js';
export type { ScrollViewProps } from './layout/ScrollView.js';
