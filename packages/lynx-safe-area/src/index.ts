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

// Provider-free live channel: the same `safeAreaChanged` subscription the
// provider uses, for a library that must follow the insets (the keyboard,
// say) without requiring the app to mount a <SafeAreaProvider> (#1232).
export { subscribeSafeArea } from './events.js';
export type { RawSafeAreaProps } from './globals.js';

export { ZERO_INSETS } from './types.js';
export type {
  EdgeInsets,
  Edge,
  SafeAreaMode,
  SafeAreaContextValue,
} from './types.js';
