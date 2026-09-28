// @sigx/lynx-zero — design-system-neutral UI foundation on the zero contract
// (signalxjs/lynx#1029). The pre-contract package lives on as
// @sigx/lynx-zero-legacy while this stack is built out.

// ── The contract ─────────────────────────────────────────────────────────
// @sigx/zero's portable contract verbatim (vocabularies, token names, the
// class grammar, variantAttrs) plus the two lynx seams: partBag (one part
// descriptor → class list + data-* attrs) and partA11y (the five-prop
// native accessibility mapping).
export * from './contract/index.js';

// ── Behaviors ────────────────────────────────────────────────────────────
// Portable zero behaviors + the lynx implementations of the adapter seams
// (press, dismiss layers, anchored positioning).
export * from './behaviors/index.js';

// ── Overlays ─────────────────────────────────────────────────────────────
// The portal substitute: ZeroRoot (theme host + outlet-last container),
// OverlayHost, useOverlayPortal.
export type { OverlayPortal, ZeroRootProps } from './overlay/OverlayHost.js';
export { OverlayHost, PortalScope, ZeroRoot, hasOverlayHost, useOverlayPortal } from './overlay/OverlayHost.js';

// ── Components (pilot wave 1) ────────────────────────────────────────────
export type { ProgressRootProps } from './components/progress/Progress.js';
export { Progress } from './components/progress/Progress.js';
export type { ButtonRootProps } from './components/button/Button.js';
export { Button } from './components/button/Button.js';
export type { SwitchRootProps } from './components/switch/Switch.js';
export { Switch } from './components/switch/Switch.js';
export type { PanelProps, TabProps, TabsRootProps } from './components/tabs/Tabs.js';
export { Tabs } from './components/tabs/Tabs.js';
export type { AccordionItemProps, AccordionRootProps } from './components/accordion/Accordion.js';
export { Accordion } from './components/accordion/Accordion.js';

// ── Components (pilot wave 2 — overlays) ────────────────────────────────
export type { DialogRootProps } from './components/dialog/Dialog.js';
export { Dialog } from './components/dialog/Dialog.js';
export type { PopoverRootProps } from './components/popover/Popover.js';
export { Popover } from './components/popover/Popover.js';
export type { ToastItem, ToastOptions, ToastPlacement, ToastViewportProps, Toaster } from './components/toast/Toast.js';
export { Toast, createToaster, provideToaster } from './components/toast/Toast.js';

// ── Components (pilot wave 3 — composites) ──────────────────────────────
export type { SelectRoot, SelectRootProps } from './components/select/Select.js';
export { Select } from './components/select/Select.js';
export type { SliderRootProps } from './components/slider/Slider.js';
export { Slider } from './components/slider/Slider.js';

// ── Components (zero#94 — a part that re-carries an axis) ───────────────
export type {
    TimelineConnectorProps,
    TimelineContentProps,
    TimelineMarkerProps,
    TimelinePartProps,
    TimelinePlacement,
    TimelineRootProps,
} from './components/timeline/Timeline.js';
export { Timeline } from './components/timeline/Timeline.js';

// ── Axis push-down ───────────────────────────────────────────────────────
export type { VariantAxes } from './contract/axes-context.js';
export { partAxes, provideCarriedAxes, provideVariantAxes, useVariantAxes } from './contract/axes-context.js';
export type { AxisDefaults } from './contract/axis-defaults.js';
export { registerAxisDefaults, resolveVariantAxes } from './contract/axis-defaults.js';

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
export type { TabsIndicatorProps, TabsListProps } from './components/tabs/Tabs.js';

// ── Toast composition parts (#1143) ──────────────────────────────────────
export type {
    ToastActionData, ToastActionProps, ToastCloseProps, ToastRootProps, ToasterOptions,
} from './components/toast/Toast.js';

// ── Overlay hit-testing contract (#1180): a portal root's `pointer-events: auto` ──
export { OVERLAY_ROOT_STYLE } from './overlay/OverlayHost.js';

// ── Components (Wave 2, forms — #1204) ───────────────────────────────────
export type { ToggleRootProps } from './components/toggle/Toggle.js';
export { Toggle } from './components/toggle/Toggle.js';
export type { ToggleGroupItemProps, ToggleGroupRoot, ToggleGroupRootProps } from './components/toggle-group/ToggleGroup.js';
export { ToggleGroup } from './components/toggle-group/ToggleGroup.js';

// ── Components (zero wave 2 — forms: checkbox, checkbox-group, radio-group, #1203) ──
export type { CheckboxRootProps } from './components/checkbox/Checkbox.js';
export { Checkbox } from './components/checkbox/Checkbox.js';
export type { CheckboxGroupLabelProps, CheckboxGroupRootProps } from './components/checkbox-group/CheckboxGroup.js';
export { CheckboxGroup } from './components/checkbox-group/CheckboxGroup.js';
export type {
    RadioGroupItemProps, RadioGroupLabelProps, RadioGroupRoot, RadioGroupRootProps,
} from './components/radio-group/RadioGroup.js';
export { RadioGroup } from './components/radio-group/RadioGroup.js';
// ── Components (zero wave 2 — text fields, W2C #1205) ───────────────────
export type { FieldLabelProps, FieldPartProps, FieldRootProps } from './components/field/Field.js';
export { Field } from './components/field/Field.js';
export type {
    EnterKeyHint, InputAdornmentProps, InputClearTriggerProps, InputControlProps, InputInputProps, InputLabelProps,
    InputMode, InputRootProps, InputType, InputVisibilityTriggerProps,
} from './components/input/Input.js';
export { Input } from './components/input/Input.js';
export type { TextareaLabelProps, TextareaRootProps, TextareaTextareaProps } from './components/textarea/Textarea.js';
export { Textarea } from './components/textarea/Textarea.js';

// ── Components (zero wave 2 — forms: W2D, #1202) ─────────────────────────
export type {
    NumberInputControlProps,
    NumberInputInputProps,
    NumberInputLabelProps,
    NumberInputRootProps,
    NumberInputTriggerProps,
} from './components/number-input/NumberInput.js';
export { NUMBER_INPUT_SPIN_INTERVAL, NumberInput } from './components/number-input/NumberInput.js';
export type { FieldsetLegendProps, FieldsetRootProps } from './components/fieldset/Fieldset.js';
export { Fieldset } from './components/fieldset/Fieldset.js';

// ── Components (zero wave 3 — display: alert, card, W3B #1235) ──────────
export type {
    AlertCloseProps, AlertDescriptionProps, AlertIconProps, AlertRootProps, AlertTitleProps,
} from './components/alert/Alert.js';
export { Alert } from './components/alert/Alert.js';
export type {
    CardBandEnds, CardMediaProps, CardPartProps, CardRootProps, CardTextProps,
} from './components/card/Card.js';
export { Card } from './components/card/Card.js';

// ── Components (zero wave 3 — display: badge, status, kbd, W3A #1234) ────
export type { BadgeDotProps, BadgeRootProps } from './components/badge/Badge.js';
export { Badge } from './components/badge/Badge.js';
export type { StatusRootProps } from './components/status/Status.js';
export { Status } from './components/status/Status.js';
export type { KbdRootProps } from './components/kbd/Kbd.js';
export { Kbd } from './components/kbd/Kbd.js';

// ── Components (zero wave 3 — display: W3D, #1236) ──────────────────────
export type { DividerLabelPlacement, DividerLabelProps, DividerRootProps } from './components/divider/Divider.js';
export { Divider } from './components/divider/Divider.js';
export type { StatsItemProps, StatsPartProps, StatsRootProps } from './components/stats/Stats.js';
export { Stats } from './components/stats/Stats.js';
export type { EmptyStatePartProps, EmptyStateRootProps } from './components/empty-state/EmptyState.js';
export { EmptyState } from './components/empty-state/EmptyState.js';
// ── Components (zero wave 3 — display: W3C, #1237) ──────────────────────
export type { AvatarFallbackProps, AvatarImageProps, AvatarRootProps, AvatarStatus } from './components/avatar/Avatar.js';
export { Avatar } from './components/avatar/Avatar.js';
export type { AvatarGroupOverflowProps, AvatarGroupRootProps } from './components/avatar-group/AvatarGroup.js';
export { AvatarGroup } from './components/avatar-group/AvatarGroup.js';
export type { SkeletonRootProps } from './components/skeleton/Skeleton.js';
export { Skeleton } from './components/skeleton/Skeleton.js';
export type { SpinnerRootProps } from './components/spinner/Spinner.js';
export { Spinner } from './components/spinner/Spinner.js';
// Toast.Indicator + promise toasts (#1196).
export type { ToastIndicatorProps, ToastInput, ToastPromiseOptions, ToastStatus } from './components/toast/Toast.js';

// ── Components (zero wave 4 — navigation: pagination, steps, W4C #1258) ──
export type { PaginationRootProps, PaginationRowEntry } from './components/pagination/Pagination.js';
export { Pagination } from './components/pagination/Pagination.js';
export type {
    StepsContentProps, StepsEntry, StepsItemProps, StepsPartProps, StepsPhase, StepsRootProps, StepsSeparatorProps,
    StepsTriggerProps,
} from './components/steps/Steps.js';
export { Steps } from './components/steps/Steps.js';
