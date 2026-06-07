// @sigx/lynx-heroui — HeroUI-flavored design system on the @sigx/lynx-zero
// foundation. Pilot scope (signalxjs/lynx#219): two built-in themes plus a
// representative component set arriving in Phase 6; grows as the shared
// contract is validated.

// Theme data — any JS import from this package's entrypoint seeds hero-light /
// hero-dark into the shared registry. (The CSS-only `…/styles` subpath does
// not execute JS; an app always imports both, like with daisyui.)
export { HERO_BUILTIN_THEMES } from './theme/builtins.js';
export type { HeroTheme } from './theme/builtins.js';

// Pilot components — built against the shared contract (semantic `color`,
// DS-specific `variant`, shared `size` scale, disabled/onPress conventions).
export { Button } from './components/Button.js';
export type { ButtonProps, ButtonColor, ButtonVariant, ButtonSize } from './components/Button.js';
export { Text } from './components/Text.js';
export type { TextProps, TextSize, TextWeight, TextColor } from './components/Text.js';
export { Heading } from './components/Heading.js';
export type { HeadingProps, HeadingLevel } from './components/Heading.js';
export { Card } from './components/Card.js';
export type { CardProps } from './components/Card.js';
export { Input } from './components/Input.js';
export type { InputProps, InputSize, InputVariant, InputColor } from './components/Input.js';
export { Textarea } from './components/Textarea.js';
export type { TextareaProps, TextareaSize, TextareaVariant, TextareaColor } from './components/Textarea.js';
export { Toggle } from './components/Toggle.js';
export type { ToggleProps, ToggleColor, ToggleSize } from './components/Toggle.js';
export { Checkbox } from './components/Checkbox.js';
export type { CheckboxProps, CheckboxColor, CheckboxSize } from './components/Checkbox.js';
export { Radio } from './components/Radio.js';
export type { RadioGroupProps, RadioItemProps, RadioColor, RadioSize } from './components/Radio.js';
export { Select } from './components/Select.js';
export type { SelectProps, SelectOption, SelectSize, SelectVariant, SelectColor } from './components/Select.js';
export { FormField } from './components/FormField.js';
export type { FormFieldProps } from './components/FormField.js';
export { Divider } from './components/Divider.js';
export type { DividerProps } from './components/Divider.js';
export { Modal } from './components/Modal.js';
export type { ModalProps } from './components/Modal.js';
export { Tabs } from './components/Tabs.js';
export type { TabsProps, TabProps } from './components/Tabs.js';

// The engine + neutral primitives, re-exported so hero apps keep a single
// import source (same shape as @sigx/lynx-daisyui).
export {
  ThemeProvider,
  useTheme,
  themeController,
  StatusBarSync,
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
