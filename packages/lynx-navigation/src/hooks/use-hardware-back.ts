import { onMounted } from '@sigx/lynx';
import { BackHandler } from '@sigx/lynx-linking';
import { useNav, type Nav } from './use-nav.js';

/**
 * Wire the Android hardware back button to the active navigator.
 *
 * Listens for `hardwareBackPress` events from `@sigx/lynx-linking`'s
 * `BackHandler` (which the native side dispatches from
 * `MainActivity.onBackPressed`). On press the handler walks to the
 * deepest currently-focused navigator (per-tab `<Stack>`s register with
 * their parent), then walks back up the `parent` chain looking for the
 * first nav that `canGoBack`:
 *
 *   - If any nav in the chain can go back → `nav.pop()` on that nav.
 *   - Otherwise → `BackHandler.exitApp()` (Android: `moveTaskToBack(true)`,
 *     keeps the bundle warm; iOS: rejects, since iOS doesn't permit
 *     programmatic termination).
 *
 * The traversal means you only need to call this once at the root — a
 * back press from inside a tab pops that tab's nested stack first, only
 * exiting the app once every level is at its base entry.
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
            // Walk down to the deepest focused nav. Per-tab `<Stack>`s
            // register themselves via `parent._children.add(nav)`; only one
            // child per level is `isLocallyFocused` at a time, so the
            // traversal is unambiguous. Falls back to the starting nav if
            // no nested stacks are wired up.
            let active: Nav = nav;
            // Loop instead of recursion so a deeply-nested tree doesn't blow
            // the stack on a synchronous back press.
            outer: while (active._children.size > 0) {
                for (const child of active._children) {
                    if (child.isLocallyFocused) {
                        active = child;
                        continue outer;
                    }
                }
                // No focused child at this level — stop drilling.
                break;
            }
            // Walk back up the chain looking for the first nav that has
            // something to pop. This is what makes "back press in trips
            // tab with empty inner stack" fall through to root (which might
            // have a modal on top) before exiting.
            let cur: Nav | null = active;
            while (cur) {
                if (cur.canGoBack) {
                    cur.pop();
                    return true;
                }
                cur = cur.parent;
            }
            // At the root with nothing to pop — leave the app. Promise is
            // fire-and-forget; we don't await because we want the back
            // press to feel instant (Android starts the move-to-back
            // transition immediately).
            void BackHandler.exitApp();
            return true;
        });
        return () => sub.remove();
    });
}
