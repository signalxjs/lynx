import { defineInjectable, type SharedValue } from '@sigx/lynx';
import type { RouteMap } from '../types.js';

/**
 * Internal injectable: the route registry passed into `<NavigationRoot>`.
 * Components (Stack, Screen) read this to look up route definitions by name.
 *
 * Not exported from the package barrel — use `useNav()` for navigation, and
 * the registry is implicit from `<NavigationRoot routes={...}>`.
 */
export const useNavRoutes = defineInjectable<RouteMap>(() => {
    throw new Error(
        '[lynx-navigation] No <NavigationRoot> found in the component tree.',
    );
});

/**
 * Internal injectable: low-level navigator handles used by the edge-back
 * gesture. Holds the progress SharedValue (so gesture worklets can write it
 * directly on MT) plus BG-side begin/commit/cancel functions invoked via
 * `runOnBackground` from gesture worklets.
 *
 * `progress` is `null` when the navigator was created with `animated={false}`
 * (e.g. tests). `beginBackGesture` is also a no-op in that case.
 */
export interface NavInternals {
    /** MT-driven transition progress; null when animations are disabled. */
    readonly progress: SharedValue<number> | null;
    /**
     * Set transition state for a gesture-driven pop. Does not start any
     * automatic animation — the gesture worklet writes `progress` directly
     * per frame, then animates to the commit/cancel endpoint on release.
     */
    beginBackGesture(): void;
    /** Commit the back gesture: pop top entry + clear transition. */
    commitBackGesture(): void;
    /** Cancel the back gesture: clear transition without popping. */
    cancelBackGesture(): void;
    /** Whether the user opted into the edge-swipe-back gesture. */
    readonly edgeSwipeEnabled: boolean;
}

export const useNavInternals = defineInjectable<NavInternals>(() => {
    throw new Error(
        '[lynx-navigation] No <NavigationRoot> found in the component tree.',
    );
});
