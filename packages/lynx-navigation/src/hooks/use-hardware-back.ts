import { onMounted } from '@sigx/lynx';
import { BackHandler } from '@sigx/lynx-linking';
import { useNav } from './use-nav.js';

/**
 * Wire the Android hardware back button to the active navigator.
 *
 * Listens for `hardwareBackPress` events from `@sigx/lynx-linking`'s
 * `BackHandler` (which the native side dispatches from
 * `MainActivity.onBackPressed`). On press:
 *
 *   - If `nav.canGoBack` → `nav.pop()`.
 *   - Otherwise → `BackHandler.exitApp()` (Android: `moveTaskToBack(true)`,
 *     keeps the bundle warm; iOS: rejects, since iOS doesn't permit
 *     programmatic termination).
 *
 * Call this once in any component under `<NavigationRoot>` (typically a
 * thin wrapper sibling to `<Stack />`). iOS doesn't fire the event so the
 * hook is a no-op there.
 *
 * @example
 * ```tsx
 * const BackHandlerWiring = component(() => {
 *     useHardwareBack();
 *     return () => null;
 * });
 *
 * <NavigationRoot routes={routes}>
 *     <BackHandlerWiring />
 *     <Stack />
 * </NavigationRoot>
 * ```
 */
export function useHardwareBack(): void {
    const nav = useNav();
    onMounted(() => {
        const sub = BackHandler.addEventListener(() => {
            if (nav.canGoBack) {
                nav.pop();
                return true;
            }
            // At the root — leave the app. Promise is fire-and-forget; we
            // don't await because we want the back press to feel instant
            // (Android starts the move-to-back transition immediately).
            void BackHandler.exitApp();
            return true;
        });
        return () => sub.remove();
    });
}
