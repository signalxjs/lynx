import { onMounted, onUnmounted } from '@sigx/lynx';
import { BackHandler } from '@sigx/lynx-linking';
import { useNav, type Nav } from './use-nav.js';

/**
 * Navigator trees with an active hardware-back registration, keyed by
 * their root nav. Used to keep wiring idempotent per tree: `<NavigationRoot>`
 * auto-wires by default, and an app that *also* calls `useHardwareBack()`
 * (or migrates from manual wiring) must not end up with two listeners that
 * both pop on a single back press. The first registration for a root wins;
 * later ones are no-ops until it unsubscribes.
 */
const wiredRoots = new WeakSet<Nav>();

/** Walk up the `parent` chain to the top-most navigator. */
function rootOf(nav: Nav): Nav {
    let cur = nav;
    while (cur.parent) cur = cur.parent;
    return cur;
}

/**
 * Subscribe the Android hardware back button/gesture to a navigator tree.
 *
 * Listens for `hardwareBackPress` events from `@sigx/lynx-linking`'s
 * `BackHandler` (which the native side dispatches from
 * `MainActivity.onBackPressed`). On press the handler walks from the tree's
 * root to the deepest currently-focused navigator (per-tab `<Stack>`s
 * register with their parent), then walks back up the `parent` chain looking
 * for the first nav that `canGoBack`:
 *
 *   - If any nav in the chain can go back → `nav.pop()` on that nav.
 *   - Otherwise → `BackHandler.exitApp()` (Android: `moveTaskToBack(true)`,
 *     keeps the bundle warm; iOS: rejects, since iOS doesn't permit
 *     programmatic termination).
 *
 * **Idempotent per tree.** Only the first registration for a given root
 * actually subscribes; later calls return a no-op disposer. So `<NavigationRoot>`
 * auto-wiring this and an app calling `useHardwareBack()` coexist without
 * double-popping.
 *
 * Returns a disposer that unsubscribes (and frees the root for re-wiring).
 * No-op on iOS (event never fires) and in non-native environments (no
 * `GlobalEventEmitter`, e.g. web/SSR/tests) — `addEventListener` returns a
 * no-op subscription there.
 *
 * @internal Apps should rely on `<NavigationRoot>`'s default or call
 * `useHardwareBack()`; this raw form exists so the root can wire from setup.
 */
export function wireHardwareBack(nav: Nav): () => void {
    const root = rootOf(nav);
    // A registration for this tree already exists — don't add a second
    // listener that would pop twice on one press.
    if (wiredRoots.has(root)) return () => {};
    wiredRoots.add(root);

    const sub = BackHandler.addEventListener(() => {
        // Walk down to the deepest focused nav. Per-tab `<Stack>`s register
        // themselves via `parent._children.add(nav)`; only one child per
        // level is `isLocallyFocused` at a time, so the traversal is
        // unambiguous. Falls back to the root if no nested stacks are wired.
        let active: Nav = root;
        // Loop instead of recursion so a deeply-nested tree doesn't blow the
        // stack on a synchronous back press.
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
        // Walk back up the chain looking for the first nav that has something
        // to pop. This is what makes "back press in trips tab with empty
        // inner stack" fall through to root (which might have a modal on top)
        // before exiting.
        let cur: Nav | null = active;
        while (cur) {
            if (cur.canGoBack) {
                cur.pop();
                return true;
            }
            cur = cur.parent;
        }
        // At the root with nothing to pop — leave the app. Promise is
        // fire-and-forget; we don't await because we want the back press to
        // feel instant (Android starts the move-to-back transition
        // immediately).
        void BackHandler.exitApp();
        return true;
    });

    return () => {
        wiredRoots.delete(root);
        sub.remove();
    };
}

/**
 * Wire the Android hardware back button to the active navigator.
 *
 * `<NavigationRoot>` already does this by default (see its `hardwareBack`
 * prop). Use this hook only when you've opted out (`hardwareBack={false}`)
 * and want to wire it yourself — it's safe to call regardless thanks to the
 * idempotency in {@link wireHardwareBack}.
 *
 * Call it once in any component under `<NavigationRoot>`. iOS doesn't fire
 * the event so the hook is a no-op there.
 *
 * @example
 * ```tsx
 * const BackHandlerWiring = component(() => {
 *     useHardwareBack();
 *     return () => null;
 * });
 *
 * <NavigationRoot routes={routes} hardwareBack={false}>
 *     <BackHandlerWiring />
 *     <Stack />
 * </NavigationRoot>
 * ```
 */
export function useHardwareBack(): void {
    const nav = useNav();
    // `onMounted`'s return value isn't a cleanup hook in sigx — register the
    // disposer with `onUnmounted` explicitly so the listener is released.
    let dispose: () => void = () => {};
    onMounted(() => { dispose = wireHardwareBack(nav); });
    onUnmounted(() => { dispose(); });
}
