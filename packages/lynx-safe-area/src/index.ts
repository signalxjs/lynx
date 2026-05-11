// Public API for @sigx/lynx-safe-area.

export { SafeAreaProvider, SAFE_AREA_EVENT } from './provider.js';
export type { SafeAreaProviderProps } from './provider.js';

export { SafeAreaView } from './safe-area-view.js';
export type { SafeAreaViewProps } from './safe-area-view.js';

export {
  useSafeAreaInsets,
  useSafeAreaSharedValues,
  useSafeAreaFrame,
  useSafeAreaInsetsMT,
} from './hooks.js';

export { useSafeAreaContext } from './injectable.js';

export {
  readGlobalSafeArea,
  GLOBAL_PROPS_KEY,
} from './globals.js';
export type { RawSafeAreaProps } from './globals.js';

export { ZERO_INSETS } from './types.js';
export type {
  EdgeInsets,
  Edge,
  SafeAreaMode,
  SafeAreaContextValue,
} from './types.js';
