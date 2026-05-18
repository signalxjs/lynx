/**
 * `useScreenOptions` — imperative merge into the current entry's options.
 *
 * Use this when options need to be set from an effect rather than declared
 * statically via `<Screen title=…>`. The canonical case is "title becomes
 * known after a fetch":
 *
 * ```ts
 * const user = useFetchUser(id);
 * useScreenOptions(() => ({
 *     title: user.value?.displayName ?? 'Loading…',
 * }));
 * ```
 *
 * The callback runs in a tracked `effect` — any signals it reads cause it
 * to re-run and re-merge. This is strictly additive: returning a partial
 * options object only touches the keys it sets, and returning `undefined`
 * for a key clears it.
 *
 * Static usage where the options never change can pass a plain object and
 * skip the effect — internally we detect that and merge once. Hosts that
 * pass a getter pay for the subscription; hosts that pass an object don't.
 */
import { effect, onUnmounted } from '@sigx/lynx';
import { useScreenRegistry } from './use-nav-internal';
import { mergeOptions } from '../internal/screen-registry';
import type { ScreenOptions } from '../types';

export function useScreenOptions(
    optionsOrFn: ScreenOptions | (() => ScreenOptions),
): void {
    const registry = useScreenRegistry();

    if (typeof optionsOrFn !== 'function') {
        mergeOptions(registry, optionsOrFn);
        return;
    }

    // Reactive path: every signal touched inside the getter is tracked, so
    // the merge re-runs when any of them change. `mergeOptions` does per-key
    // writes on a deeply-reactive proxy, so consumers (HeaderBar) only
    // re-render the parts they actually read.
    const runner = effect(() => {
        const next = optionsOrFn();
        mergeOptions(registry, next);
    });
    onUnmounted(() => runner.stop());
}
