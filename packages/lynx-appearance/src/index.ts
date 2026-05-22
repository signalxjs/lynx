// Public API for @sigx/lynx-appearance.

export { AppearanceProvider, APPEARANCE_EVENT } from './provider.js';
export type { AppearanceProviderProps } from './provider.js';

export { useAppearanceContext } from './injectable.js';
export type { AppearanceContextValue } from './injectable.js';

export {
  useSystemColorScheme,
  useSystemColorSchemeMT,
} from './hooks.js';

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
