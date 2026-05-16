import { component, defineProvide, onUnmounted, type Define } from '@sigx/lynx';
import { useCurrentEntry, useNavInternals, useScreenRegistry } from '../hooks/use-nav-internal.js';
import { createScreenRegistry } from '../internal/screen-registry.js';
import type { StackEntry } from '../types.js';

type EntryScopeProps =
    & Define.Prop<'entry', StackEntry, true>
    & Define.Slot<'default'>;

/**
 * Provider wrapper for a single screen mount.
 *
 * `<Stack>` and `<ScreenContainer>` instantiate this around each route
 * component so calls to `useIsFocused()` / `useFocusEffect()` /
 * `<Screen>` inside that screen resolve through `useCurrentEntry()` and
 * `useScreenRegistry()` to the entry it was rendered for. Without this
 * wrapper there'd be no per-screen way to know "which stack entry am I?"
 * — the navigator only knows what's currently on top.
 *
 * Also allocates a fresh `ScreenRegistry` per entry and publishes it to
 * the navigator's cross-entry registry map, so persistent chrome (HeaderBar
 * / TabBar — later slices) can read the focused entry's options + slot
 * fills without remounting itself.
 *
 * Renders the default slot directly; no extra layout element is inserted,
 * so this is layout-neutral for the screen it wraps.
 */
export const EntryScope = component<EntryScopeProps>(({ props, slots }) => {
    const internals = useNavInternals();
    const registry = createScreenRegistry(props.entry);
    internals.screens.register(registry);
    onUnmounted(() => {
        internals.screens.unregister(props.entry.key);
    });
    defineProvide(useCurrentEntry, () => props.entry);
    defineProvide(useScreenRegistry, () => registry);
    return () => slots.default?.();
});
