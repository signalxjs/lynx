// Public API for @sigx/lynx-safe-area.

export { SafeAreaProvider, SAFE_AREA_EVENT } from './provider';
export type { SafeAreaProviderProps } from './provider';

export { SafeAreaView } from './safe-area-view';
export type { SafeAreaViewProps } from './safe-area-view';

export {
  useSafeAreaInsets,
  useSafeAreaSharedValues,
  useSafeAreaFrame,
  useSafeAreaInsetsMT,
} from './hooks';

export { useSafeAreaContext } from './injectable';

export {
  readGlobalSafeArea,
  GLOBAL_PROPS_KEY,
} from './globals';
export type { RawSafeAreaProps } from './globals';

export { ZERO_INSETS } from './types';
export type {
  EdgeInsets,
  Edge,
  SafeAreaMode,
  SafeAreaContextValue,
} from './types';
