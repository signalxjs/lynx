import { component, computed, defineProvide, onUnmounted, provideScreenActive, type Define } from '@sigx/lynx';
import { useNav } from '../hooks/use-nav.js';
import {
    useCurrentEntry,
    useCurrentEntryOptional,
    useNavInternals,
    useScreenRegistry,
} from '../hooks/use-nav-internal.js';
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
 * Also provides the screen's ACTIVITY (`useScreenActive()` in
 * `@sigx/lynx`, #1308): the screen is active while it is the focused top of
 * its navigator and no transition is in flight. A covered screen stays
 * mounted, and a surface that paints above the whole page (an overlay
 * outlet) or listens for back reads this to hide and stand down. The
 * transition gate makes a covered screen go inactive the moment a push
 * starts, and a revealed one come back only once the pop has settled, so
 * a window-wide overlay never paints over a screen sliding past it.
 *
 * Renders the default slot directly; no extra layout element is inserted,
 * so this is layout-neutral for the screen it wraps.
 */
export const EntryScope = component<EntryScopeProps>(({ props, slots }) => {
    const internals = useNavInternals();
    const registry = createScreenRegistry(props.entry);
    internals.screens.register(registry);
    onUnmounted(() => {
        // Pass the registry instance — `unregister` is identity-checked,
        // so this is a no-op when a newer EntryScope has already taken
        // over the same entry key (e.g. at the transition→idle handoff
        // where the reconciler mounts the new EntryScope before
        // unmounting the old).
        internals.screens.unregister(registry);
    });
    const nav = useNav();
    const entryKey = props.entry.key;
    const active = computed(() => nav.current.key === entryKey && nav.isLocallyFocused && nav.transition === null);
    provideScreenActive(() => active.value);
    defineProvide(useCurrentEntry, () => props.entry);
    defineProvide(useCurrentEntryOptional, () => props.entry);
    defineProvide(useScreenRegistry, () => registry);
    return () => slots.default?.();
});
