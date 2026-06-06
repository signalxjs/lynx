// @sigx/lynx-heroui — HeroUI-flavored design system on the @sigx/lynx-zero
// foundation. Pilot scope (signalxjs/lynx#219): two built-in themes plus a
// representative component set arriving in Phase 6; grows as the shared
// contract is validated.

// Theme data — any JS import from this package's entrypoint seeds hero-light /
// hero-dark into the shared registry. (The CSS-only `…/styles` subpath does
// not execute JS; an app always imports both, like with daisyui.)
export { HERO_BUILTIN_THEMES } from './theme/builtins.js';
export type { HeroTheme } from './theme/builtins.js';

// The engine + neutral primitives, re-exported so hero apps keep a single
// import source (same shape as @sigx/lynx-daisyui).
export {
  ThemeProvider,
  useTheme,
  themeController,
  StatusBarSync,
  useScreenTheme,
  listThemes,
  registerTheme,
  extendTheme,
  pickThemeFor,
  pairOf,
  variantOf,
  colorsOf,
  radiusOf,
  sizesOf,
  Row,
  Col,
  Center,
  Spacer,
  ScrollView,
  resolveColorToken,
} from '@sigx/lynx-zero';
export type {
  ThemeName,
  ThemeController,
  ThemeProviderProps,
  Theme,
  ThemePalette,
  ThemeRadius,
  ThemeSizes,
  ThemeVariant,
  StatusBarSyncProps,
  RowProps,
  ColProps,
  CenterProps,
  SpacerProps,
  ScrollViewProps,
  SizeScale,
  ColorVariant,
  ColorToken,
  BackgroundValue,
} from '@sigx/lynx-zero';
