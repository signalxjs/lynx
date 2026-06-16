// Buttons
export { Button } from './buttons/Button.js';
export type { ButtonProps, ButtonColor, ButtonVariant, ButtonSize } from './buttons/Button.js';

// Layout — Card and Divider are daisy-styled; the neutral primitives
// (Row/Col/Center/Spacer/ScrollView) live in @sigx/lynx-zero and are
// re-exported here so daisy apps keep a single import source.
export { Card } from './layout/Card.js';
export type { CardProps } from './layout/Card.js';
export { Divider } from './layout/Divider.js';
export type { DividerProps } from './layout/Divider.js';
export { Row, Col, Center, Spacer, ScrollView } from '@sigx/lynx-zero';
export type {
  RowProps, ColProps, CenterProps, SpacerProps, ScrollViewProps,
} from '@sigx/lynx-zero';

// Shared style primitives + the design-system contract — re-exported from
// the neutral foundation (@sigx/lynx-zero) so daisy apps keep a single
// import source. `DaisyColor`/`resolveDaisyColor` are this package's
// historical names for the contract's ColorToken/resolveColorToken.
export type {
  BackgroundValue, SpacingValue, BoxProps,
  SizeScale, ColorVariant, ColorToken,
  ColorToken as DaisyColor,
} from '@sigx/lynx-zero';
export {
  resolveColorToken,
  resolveColorToken as resolveDaisyColor,
} from '@sigx/lynx-zero';

// Forms
export { Input } from './forms/Input.js';
export type { InputProps, InputSize, InputVariant, InputColor } from './forms/Input.js';
export { Toggle } from './forms/Toggle.js';
export type { ToggleProps, ToggleColor, ToggleSize } from './forms/Toggle.js';
export { Checkbox } from './forms/Checkbox.js';
export type { CheckboxProps, CheckboxColor, CheckboxSize } from './forms/Checkbox.js';
export { Select } from './forms/Select.js';
export type { SelectProps, SelectSize, SelectVariant, SelectColor, SelectOption } from './forms/Select.js';
export { Radio } from './forms/Radio.js';
export type { RadioGroupProps, RadioItemProps, RadioColor, RadioSize } from './forms/Radio.js';
export { Rating } from './forms/Rating.js';
export type { RatingProps, RatingColor, RatingSize } from './forms/Rating.js';
export { Textarea } from './forms/Textarea.js';
export type { TextareaProps, TextareaSize, TextareaVariant, TextareaColor } from './forms/Textarea.js';
export { FormField } from './forms/FormField.js';
export type { FormFieldProps } from './forms/FormField.js';

// Feedback
export { Badge } from './feedback/Badge.js';
export type { BadgeProps, BadgeColor, BadgeVariant, BadgeSize } from './feedback/Badge.js';
export { Alert } from './feedback/Alert.js';
export type { AlertProps, AlertColor } from './feedback/Alert.js';
export { Loading } from './feedback/Loading.js';
export type { LoadingProps, LoadingType, LoadingSize, LoadingColor } from './feedback/Loading.js';
export { Progress } from './feedback/Progress.js';
export type { ProgressProps, ProgressColor } from './feedback/Progress.js';
export { Modal } from './feedback/Modal.js';
export type { ModalProps } from './feedback/Modal.js';
export { Skeleton } from './feedback/Skeleton.js';
export type { SkeletonProps } from './feedback/Skeleton.js';
export { Steps } from './feedback/Steps.js';
export type { StepsProps, StepProps, StepColor } from './feedback/Steps.js';

// Navigation
export { Tabs } from './navigation/Tabs.js';
export type { TabsProps, TabProps } from './navigation/Tabs.js';
export { NavTabBar } from './navigation/NavTabBar.js';
export type {
    NavTabBarProps,
    NavTabBarPosition,
    NavTabBarBackground,
    NavTabRenderContext,
} from './navigation/NavTabBar.js';
export { NavHeader } from './navigation/NavHeader.js';
export type {
    NavHeaderProps,
    NavHeaderBackground,
} from './navigation/NavHeader.js';
export { NavDrawer } from './navigation/NavDrawer.js';
export type {
    NavDrawerProps,
    NavDrawerSide,
} from './navigation/NavDrawer.js';
// SwiperIndicator is design-system-neutral — it now lives in @sigx/lynx-zero
// (#317) and daisy re-exports it so the public API is unchanged.
export { SwiperIndicator } from '@sigx/lynx-zero';
export type {
    SwiperIndicatorProps,
    SwiperIndicatorVariant,
    SwiperIndicatorSize,
} from '@sigx/lynx-zero';

// Theme — the engine lives in @sigx/lynx-zero; daisy wraps it with its six
// built-in palettes (seeded at module load via ./theme/builtins.ts) and the
// icon color resolver. ./theme/ThemeProvider.js re-exports the engine API so
// daisy apps keep a single import source.
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
    DaisyTheme,
    ThemeController,
    ThemeProviderProps,
    Theme,
    ThemePalette,
    ThemeRadius,
    ThemeSizes,
    ThemeVariant,
} from './theme/ThemeProvider.js';
// Headless theme handle (issue #113) + bar sync — engine pieces re-exported
// from @sigx/lynx-zero. Per-screen theming (`useScreenTheme`) lives on the
// `@sigx/lynx-zero/screen-theme` subpath (it needs the optional
// `@sigx/lynx-navigation` peer, so it stays out of the barrels).
export { StatusBarSync, themeController } from '@sigx/lynx-zero';
export type { StatusBarSyncProps } from '@sigx/lynx-zero';

// Data
export { Avatar } from './data/Avatar.js';
export type { AvatarProps, AvatarSize } from './data/Avatar.js';

// Typography
export { Text } from './typography/Text.js';
export type { TextProps, TextSize, TextWeight, TextColor, TextAutoSize, TextAutoSizeLineRange } from './typography/Text.js';
export { Heading } from './typography/Heading.js';
export type { HeadingProps, HeadingLevel } from './typography/Heading.js';

// Markdown — daisyUI rendering + editor theming for `@sigx/lynx-markdown`
// (optional peer).
export { markdownComponents } from './markdown/components.js';
export { useMarkdownEditorTheme } from './markdown/editorTheme.js';
export type { MarkdownEditorThemeColors } from './markdown/editorTheme.js';
export { EditorToolbar, daisyToolbarItem } from './markdown/toolbar.js';
export type { EditorToolbarProps } from './markdown/toolbar.js';

// Emoji — daisyUI skin + themed sheet for `@sigx/lynx-emoji` (optional peer).
export { emojiClasses } from './emoji/components.js';
export { EmojiPickerSheet } from './emoji/EmojiPickerSheet.js';
export type { EmojiPickerSheetProps } from './emoji/EmojiPickerSheet.js';
