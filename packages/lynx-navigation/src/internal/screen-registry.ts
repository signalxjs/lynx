/**
 * Per-entry registry of `<Screen>` options + slot fills.
 *
 * Each `<EntryScope>` allocates one of these on mount and provides it to
 * descendants via `defineProvide(useScreenRegistry, ...)`. The Screen
 * component and its sub-components (`<Screen.Header>`, `<Screen.HeaderLeft>`,
 * `<Screen.HeaderRight>`, `<Screen.TabBarItem>`) write into the registry as
 * they mount.
 *
 * Reads track because options/slots are stored in signals — when a child
 * re-renders and registers a new slot fill, the navigator-side consumer
 * (HeaderBar / TabBar, shipped in later slices) reactively updates.
 *
 * Cross-entry lookup is exposed via the navigator's `getScreenRegistry(key)`
 * so a persistent HeaderBar can read slots from the currently-focused entry
 * without needing to be itself remounted on each navigation.
 */
import { signal, type Signal } from '@sigx/lynx';
import type {
    ScreenOptions,
    ScreenSlotFills,
    StackEntry,
} from '../types';

/**
 * Reactive container for one screen's options and slot fills.
 *
 * `options` and `slots` are deeply-reactive object signals (sigx's `signal()`
 * of an object returns a Proxy that tracks per-key reads and notifies
 * per-key writes). Writers assign individual keys; readers subscribe to the
 * keys they actually use — no whole-object reads, no read/write cycles in
 * setup.
 */
export interface ScreenRegistry {
    readonly entry: StackEntry;
    /** Reactive ScreenOptions — written per-key by `<Screen>`. */
    readonly options: Signal<ScreenOptions>;
    /** Reactive ScreenSlotFills — written per-key by `<Screen.Header>` et al. */
    readonly slots: Signal<ScreenSlotFills>;
}

/** Create a fresh registry for an entry. Options and slots start empty. */
export function createScreenRegistry(entry: StackEntry): ScreenRegistry {
    return {
        entry,
        options: signal<ScreenOptions>({}),
        slots: signal<ScreenSlotFills>({}),
    };
}

/**
 * Set a single slot fill on a registry. Pass `undefined` to clear.
 * Per-key write on the proxy — does not read other keys, so it can't loop
 * with effects that read different slot keys.
 */
export function setSlot<K extends keyof ScreenSlotFills>(
    registry: ScreenRegistry,
    name: K,
    fill: ScreenSlotFills[K] | undefined,
): void {
    if (fill === undefined) {
        // Assigning undefined keeps the key around in the proxy; explicit
        // delete is what consumers checking `name in slots` expect.
        delete registry.slots[name];
        return;
    }
    (registry.slots as ScreenSlotFills)[name] = fill;
}

/**
 * Merge partial options into a registry. Each option key is written
 * independently on the proxy — `undefined` keys clear that option.
 */
export function mergeOptions(
    registry: ScreenRegistry,
    patch: ScreenOptions,
): void {
    for (const key of Object.keys(patch) as (keyof ScreenOptions)[]) {
        const v = patch[key];
        if (v === undefined) {
            delete registry.options[key];
        } else {
            // Property-level assignment on a deeply-reactive proxy: notifies
            // only subscribers of this specific key, never reads the whole
            // options object, so it can't trigger the setup that wrote it.
            (registry.options as unknown as Record<string, unknown>)[key] = v;
        }
    }
}
