/**
 * `<Screen>` — declarative per-screen options + slot fills.
 *
 * Usage:
 *
 * ```tsx
 * const ProfileScreen = component(() => () => (
 *   <Screen title="Profile" headerShown gestureEnabled>
 *     <Screen.HeaderRight>
 *       <text bindtap={onEdit}>Edit</text>
 *     </Screen.HeaderRight>
 *     <view>body…</view>
 *   </Screen>
 * ));
 * ```
 *
 * `<Screen>` itself renders its `default` slot inline — so the body lives
 * where you'd expect with no extra layout wrapper. The sub-components
 * (`Screen.Header`, `Screen.HeaderLeft`, `Screen.HeaderRight`,
 * `Screen.TabBarItem`) render `null` and write into the entry's
 * `ScreenRegistry`. The navigator's persistent chrome reads from there.
 *
 * Note: `<Screen.TabBarItem>` registers a scoped slot fill on the entry's
 * `ScreenRegistry`, but the built-in `<TabBar>` doesn't read it yet — the
 * fill is exposed for custom tab-bar renderers (pass `renderTab` and look
 * up the active entry's registry yourself).
 *
 * Sub-component placement inside `<Screen>` is conventional — sigx scopes
 * are by component tree, so they work anywhere under the same EntryScope.
 * Placing them as direct children of `<Screen>` keeps the call site
 * declarative and grep-friendly.
 */
import { component, onUnmounted, type Define } from '@sigx/lynx';
import type { DetentSpec } from '@sigx/lynx-sheet';
import { useScreenRegistry } from '../hooks/use-nav-internal.js';
import { mergeOptions, setSlot } from '../internal/screen-registry.js';
import type { ScreenOptions } from '../types.js';

type ScreenProps =
    & Define.Prop<'title', string | (() => string)>
    & Define.Prop<'headerShown', boolean>
    & Define.Prop<'gestureEnabled', boolean>
    & Define.Prop<'detents', readonly DetentSpec[]>
    & Define.Prop<'initialDetentIndex', number>
    & Define.Prop<'backdropDismiss', boolean>
    & Define.Prop<'backdrop', boolean>
    & Define.Prop<'dragMode', 'surface' | 'grabber' | 'none'>
    & Define.Slot<'default'>;

const ScreenRoot = component<ScreenProps>(({ props, slots }) => {
    const registry = useScreenRegistry();
    // Apply options whenever the component sets up. Only set keys that
    // were actually passed — `mergeOptions` treats `undefined` as "clear
    // this key", so building the patch from raw `props.X` would wipe
    // every option a previous `useScreenOptions(...)` (or another `<Screen>`)
    // had set on this same entry.
    const patch: ScreenOptions = {};
    if (props.title !== undefined) patch.title = props.title;
    if (props.headerShown !== undefined) patch.headerShown = props.headerShown;
    if (props.gestureEnabled !== undefined) patch.gestureEnabled = props.gestureEnabled;
    if (props.detents !== undefined) patch.detents = props.detents;
    if (props.initialDetentIndex !== undefined) patch.initialDetentIndex = props.initialDetentIndex;
    if (props.backdropDismiss !== undefined) patch.backdropDismiss = props.backdropDismiss;
    if (props.backdrop !== undefined) patch.backdrop = props.backdrop;
    if (props.dragMode !== undefined) patch.dragMode = props.dragMode;
    mergeOptions(registry, patch);
    return () => slots.default?.();
});

type SimpleSlotProps = Define.Slot<'default'>;

/**
 * Build a sub-component that registers its `default` slot under `name` on
 * the current screen's registry. Unmount removes the fill so navigating
 * away from a screen with a `<Screen.HeaderRight>` clears that action.
 */
function makeSlotFiller(name: 'header' | 'headerLeft' | 'headerRight') {
    return component<SimpleSlotProps>(({ slots }) => {
        const registry = useScreenRegistry();
        setSlot(registry, name, () => slots.default?.());
        onUnmounted(() => setSlot(registry, name, undefined));
        return () => null;
    });
}

const Header = makeSlotFiller('header');
const HeaderLeft = makeSlotFiller('headerLeft');
const HeaderRight = makeSlotFiller('headerRight');

/**
 * `<Screen.TabBarItem>` — scoped slot. The default slot is a function that
 * receives `{ active }`; whatever it returns is the tab-bar item content.
 *
 * This is now declared as a genuine scoped slot. It used to be a plain
 * `Define.Slot<'default'>` whose body happened to be a function, because the
 * renderer did not invoke function children and the navigator had to call that
 * function itself. Core 0.14 invokes a function child as a scoped slot (core
 * #476), so the honest declaration and the runtime finally agree — and the
 * `active` flag is type-checked at the call site instead of being cast.
 */
type TabBarItemProps = Define.Slot<'default', { active: boolean }>;

const TabBarItem = component<TabBarItemProps>(({ slots }) => {
    const registry = useScreenRegistry();
    setSlot(registry, 'tabBarItem', (ctx) => {
        // `ctx` goes INTO the slot call: core 0.14 invokes a function child as
        // a scoped slot (core #476), so the function runs here rather than
        // being handed back. Calling `slots.default?.()` with no argument would
        // invoke `({ active }) => …` with `undefined` and throw on the
        // destructure, before the normalise below ever ran.
        const out = slots.default?.(ctx);
        // The normalise stays: a nested function (or a single-element array
        // holding one) still has to be applied to `ctx` by hand, and plain JSX
        // children pass straight through with `active` ignored.
        if (typeof out === 'function') return (out as (c: typeof ctx) => unknown)(ctx);
        if (Array.isArray(out)) {
            const first = out[0];
            if (typeof first === 'function') return (first as (c: typeof ctx) => unknown)(ctx);
        }
        return out;
    });
    onUnmounted(() => setSlot(registry, 'tabBarItem', undefined));
    return () => null;
});

/**
 * Compound export. `Screen` is callable as a JSX element and exposes the
 * sub-components as properties (`Screen.Header`, etc.) for the declarative
 * call site shown in the file header.
 */
export const Screen = Object.assign(ScreenRoot, {
    Header,
    HeaderLeft,
    HeaderRight,
    TabBarItem,
});
