import { defineInjectable, type SharedValue } from '@sigx/lynx';
import type { ScreenRegistry } from '../internal/screen-registry.js';
import type { RouteMap, StackEntry } from '../types.js';

/**
 * Internal injectable: the `StackEntry` the calling screen was rendered for.
 *
 * Provided by `<EntryScope>` which `<Stack>` and `<ScreenContainer>` wrap
 * around each screen component mount. Screens use this to derive their own
 * focus state (`useIsFocused`, `useFocusEffect`) without having to track
 * `entry.key` themselves.
 *
 * Default throws so calling `useIsFocused()` outside a screen mounted by a
 * navigator surfaces a clear error rather than silently returning `false`.
 */
export const useCurrentEntry = defineInjectable<StackEntry>(() => {
    throw new Error(
        '[lynx-navigation] No screen entry in scope. `useIsFocused` / `useFocusEffect` must be called from a component rendered as a route by <Stack>.',
    );
});

/**
 * Soft companion to {@link useCurrentEntry} — returns the current scope's
 * entry if any, `null` when called outside an `<EntryScope>` instead of
 * throwing. Provided alongside the strict version by `<EntryScope>`.
 *
 * Used by chrome consumers (`useScreenChrome`) where "no scoped entry"
 * is a legitimate state (a Stack chrome slot lives outside the screen's
 * EntryScope) and the caller wants to soft-fallback to the navigator's
 * destination entry rather than crash.
 */
export const useCurrentEntryOptional = defineInjectable<StackEntry | null>(
    () => null,
);

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
     * Dedicated `presentation: 'sheet'` progress SV ("open fraction":
     * 0 = off-screen, 1 = largest snap). Separate from `progress`, which
     * resets at every transition start and so can't hold a resting sheet's
     * position. Created by the root `<NavigationRoot>` only — sheets always
     * escalate to the root stack; null when animations are disabled.
     */
    readonly sheetProgress: SharedValue<number> | null;
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
    /**
     * Commit a sheet drag-to-dismiss: pop the top sheet entry without
     * re-animating (the drag worklet already moved the sheet SV to 0).
     */
    commitSheetDismiss(): void;
    /** Whether the user opted into the edge-swipe-back gesture. */
    readonly edgeSwipeEnabled: boolean;
    /**
     * Cross-entry screen registry controller. `<EntryScope>` calls
     * `register` on mount and `unregister` on unmount. Persistent chrome
     * (HeaderBar / TabBar — later slices) calls `get(entryKey)` to read
     * the focused screen's options + slot fills without remounting itself.
     */
    readonly screens: {
        register(registry: ScreenRegistry): void;
        /**
         * Identity-checked: only removes the entry if `registry` is the
         * one currently registered under its `entry.key`. A no-op when
         * a newer registry has already taken that slot (which happens
         * at the transition→idle handoff, where a fresh `<EntryScope>`
         * for the same entry mounts before the old one's unmount fires).
         */
        unregister(registry: ScreenRegistry): void;
        get(entryKey: string): ScreenRegistry | undefined;
    };
}

export const useNavInternals = defineInjectable<NavInternals>(() => {
    throw new Error(
        '[lynx-navigation] No <NavigationRoot> found in the component tree.',
    );
});

/**
 * Internal injectable: the calling screen's `ScreenRegistry`.
 *
 * Provided by `<EntryScope>` alongside `useCurrentEntry`. The `<Screen>`
 * component and its slot-filling sub-components write options and slot
 * fills here; the navigator's persistent chrome (HeaderBar, TabBar — later
 * slices) reads from this registry via `getScreenRegistry(key)` on the
 * navigator state, which keys into a cross-entry map.
 *
 * Throws when used outside an EntryScope so calling `<Screen>` at the app
 * root surfaces a clear error rather than silently no-op'ing.
 */
export const useScreenRegistry = defineInjectable<ScreenRegistry>(() => {
    throw new Error(
        '[lynx-navigation] No screen registry in scope. `<Screen>` (and `<Screen.Header>`, etc.) must be used inside a route component rendered by `<Stack>`.',
    );
});
