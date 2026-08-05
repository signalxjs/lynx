import {
    computed,
    effect,
    onUnmounted,
    untrack,
    type Computed,
} from '@sigx/lynx';
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
    // AND in `nav.isLocallyFocused` so a screen in a nested stack (e.g. a
    // per-tab `<Stack>`) reports unfocused when its enclosing tab is
    // inactive, or when a modal on the root nav covers everything — even
    // though it's still the top of its own (paused) stack. Root nav's
    // `isLocallyFocused` is permanently true, so this reduces to the
    // previous behavior for un-nested apps.
    return computed(() => nav.current.key === myKey && nav.isLocallyFocused);
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
    gatedSession(useIsFocused(), cb);
}

/**
 * Run `cb` once this screen has *finished* appearing — focused AND with no
 * transition in flight — and run the returned cleanup when either stops
 * holding, or on unmount.
 *
 * Use this instead of `useFocusEffect` for work heavy enough to disturb the
 * entrance animation. `useIsFocused` is `nav.current.key === myKey`, and a
 * push commits the stack *immediately* (the slide is still running), so
 * `useFocusEffect` fires while the transition is mid-flight. Mount work
 * scheduled there competes with the tween: component setup runs on the BG
 * thread, but the resulting op batch is applied on the MAIN thread in one
 * uninterruptible pass, which is the same thread driving the animation.
 *
 * Lifecycle:
 *  - cb runs at mount only if the screen is already focused and at rest
 *    (e.g. the initial route, or a non-animated navigation).
 *  - After an animated push, cb runs when the slide completes.
 *  - Losing focus, or a new transition starting, runs cleanup; settling back
 *    into focus-at-rest runs `cb` again.
 *
 * @example
 * ```tsx
 * // Mount an expensive panel only after the screen has landed.
 * useDidAppear(() => { ready.value = true; });
 * ```
 */
export function useDidAppear(cb: () => void | (() => void)): void {
    const nav = useNav();
    const isFocused = useIsFocused();
    gatedSession(computed(() => isFocused.value && nav.transition === null), cb);
}

/**
 * Shared lifecycle for the focus-gated hooks above: tear down the previous
 * session before opening a new one, and always clean up on unmount.
 */
function gatedSession(gate: Computed<boolean>, cb: () => void | (() => void)): void {
    let cleanup: (() => void) | void;
    const runner = effect(() => {
        const open = gate.value;
        // Always tear down any previous session before starting a new one (or
        // before going dormant). Wrap `cb` in `untrack` so signals read inside
        // the user-provided callback can't retrigger the outer effect and
        // stack subscriptions.
        if (typeof cleanup === 'function') {
            const fn = cleanup;
            cleanup = undefined;
            fn();
        }
        if (open) {
            cleanup = untrack(() => cb());
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
