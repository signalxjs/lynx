// Public API for @sigx/lynx-appearance.

export { AppearanceProvider, APPEARANCE_EVENT } from './provider.js';
export type { AppearanceProviderProps } from './provider.js';

export { useAppearanceContext } from './injectable.js';
export type { AppearanceContextValue } from './injectable.js';

export {
  useSystemColorScheme,
  useSystemColorSchemeMT,
} from './hooks.js';

// OS font scale — hosted in @sigx/lynx-core (which owns the native
// publisher); re-exported here because "how big should text be" is an
// appearance concern and this package's docs cover it.
export {
  useFontScale,
  useFontScaleMT,
  readGlobalFontScale,
  FONT_SCALE_EVENT,
  FONT_SCALE_GLOBAL_KEY,
} from '@sigx/lynx-core';
export type { RawFontScaleProps } from '@sigx/lynx-core';

export {
  setStatusBarStyle,
  setStatusBarBackgroundColor,
  setNavigationBarStyle,
  setSystemBarsStyle,
  isAvailable,
} from './setters.js';

export {
  readGlobalColorScheme,
  GLOBAL_PROPS_KEY,
} from './globals.js';
export type { RawAppearanceProps } from './globals.js';

export type {
  ColorScheme,
  SystemBarStyle,
  SystemBarsStyleInput,
  SetterResult,
} from './types.js';
