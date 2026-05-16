import { computed, effect, onUnmounted, type Computed } from '@sigx/lynx';
import { useNav } from './use-nav.js';
import { useCurrentEntry } from './use-nav-internal.js';

/**
 * Reactive "is this screen the focused entry?" signal.
 *
 * Must be called from inside a component rendered as a route by `<Stack>` (or
 * any other navigator that uses `<EntryScope>`); throws otherwise. The
 * returned `Computed` reads `nav.current.key` and compares it to the entry
 * the calling screen was mounted for, so any nav mutation that changes the
 * top entry flips the value.
 *
 * Note: screens stay mounted when something is pushed on top of them — they
 * just lose focus. Pop the new top off and they regain focus.
 *
 * @example
 * ```tsx
 * const Profile = component(() => {
 *     const isFocused = useIsFocused();
 *     return () => <text>{isFocused.value ? 'visible' : 'hidden'}</text>;
 * });
 * ```
 */
export function useIsFocused(): Computed<boolean> {
    const nav = useNav();
    // Capture the entry's key once at setup. The entry object provided
    // through `defineProvide` may carry reactive dependencies; we only care
    // about the immutable key of the entry this screen was mounted for.
    const myKey = useCurrentEntry().key;
    return computed(() => nav.current.key === myKey);
}

/**
 * Run `cb` whenever this screen gains focus; run the returned cleanup when it
 * loses focus or unmounts. Mirrors React Navigation's `useFocusEffect`.
 *
 * Lifecycle:
 *  - cb runs immediately if the screen is already focused at mount.
 *  - When the screen loses focus (something pushed on top), cleanup runs.
 *  - When focus returns (the cover is popped), `cb` runs again — yielding a
 *    fresh cleanup for the next blur.
 *  - On unmount, cleanup runs once if still focused.
 *
 * Common uses: subscribe to a data source while visible, track an analytics
 * "screen view" event, start/stop a polling loop.
 *
 * @example
 * ```tsx
 * useFocusEffect(() => {
 *     const id = setInterval(refresh, 5000);
 *     return () => clearInterval(id);
 * });
 * ```
 */
export function useFocusEffect(cb: () => void | (() => void)): void {
    const isFocused = useIsFocused();
    let cleanup: (() => void) | void;
    const runner = effect(() => {
        const focused = isFocused.value;
        if (focused) {
            cleanup = cb();
        } else if (typeof cleanup === 'function') {
            const fn = cleanup;
            cleanup = undefined;
            fn();
        }
    });
    onUnmounted(() => {
        if (typeof cleanup === 'function') {
            const fn = cleanup;
            cleanup = undefined;
            fn();
        }
        runner.stop();
    });
}
