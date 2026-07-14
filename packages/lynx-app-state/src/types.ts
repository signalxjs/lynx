/**
 * App activity state, two-state model:
 *
 * - `'active'` — the app is foregrounded and interactive.
 * - `'background'` — the app has been sent to the background.
 *
 * iOS's transient `inactive` phase (control-center pull, incoming call,
 * app-switcher zoom) is deliberately NOT modeled: only
 * `didEnterBackgroundNotification` counts as `'background'`, so brief
 * interruptions don't flap listeners that pause work on background.
 */
export type AppStateStatus = 'active' | 'background';

/** Listener signature for {@link addAppStateListener}. */
export type AppStateListener = (state: AppStateStatus) => void;
