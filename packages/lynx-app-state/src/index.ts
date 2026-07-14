// Public API for @sigx/lynx-app-state.

export {
    currentAppState,
    addAppStateListener,
    useAppState,
    isAvailable,
    APP_STATE_EVENT,
} from './state.js';

export type { AppStateStatus, AppStateListener } from './types.js';
