// @sigx/lynx-zero — design-system-neutral UI foundation.
//
// Holds what every design-system package (@sigx/lynx-daisyui,
// @sigx/lynx-heroui, …) shares: the props/token contract, style utilities
// and press-feedback defaults. The theme engine and layout primitives move
// here in later phases (see signalxjs/lynx#219).

// The shared contract: scales, semantic colors, prop fragments,
// token-name conventions.
export type {
  SizeScale,
  ColorVariant,
  ColorToken,
  BackgroundValue,
  WithClass,
  WithDisabled,
  WithColor,
  WithSize,
  PressEvent,
} from './contract.js';
export { resolveColorToken } from './contract.js';

// Box-model style helpers.
export type { SpacingValue, BoxProps } from './shared/styles.js';
export { resolveSpacing, resolveBoxStyle } from './shared/styles.js';

// Press-feedback defaults for interactive components.
export { PRESSED_SCALE, PRESSED_OPACITY } from './shared/press.js';
