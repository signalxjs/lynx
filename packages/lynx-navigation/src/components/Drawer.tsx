/**
 * `<Drawer>` — minimal off-canvas drawer navigator.
 *
 * Usage:
 *
 * ```tsx
 * <NavigationRoot routes={routes}>
 *   <Drawer
 *     sidebar={() => <view><text>Menu</text></view>}
 *   >
 *     <Stack />
 *   </Drawer>
 * </NavigationRoot>
 * ```
 *
 * `useDrawer()` from inside any descendant gives `{ isOpen, open(), close(),
 * toggle() }`. The sidebar is laid out absolutely on the left and is
 * visible whenever `isOpen` is true.
 *
 * Scope: this slice ships the state primitive + the bare-bones layout.
 * Gesture-driven open (edge swipe from the left) and MTS slide-in are out
 * of scope — the app shell can wrap its sidebar JSX in its own transition.
 *
 * Design note: the sidebar is passed as a render function via the
 * `sidebar` slot prop rather than a `<Drawer.Sidebar>` child. Mixing
 * "register-yourself-as-a-fill" children with the parent's own visible
 * layout creates a feedback loop in sigx's reactive scope (the parent's
 * render reads the fill, child's setup writes it, parent re-renders,
 * child re-mounts, …). A scoped slot avoids that entirely and the API
 * is identical at the call site.
 *
 * `default` slot is the main content (almost always a `<Stack>`).
 */
import {
    component,
    defineInjectable,
    defineProvide,
    signal,
    type Define,
    type Signal,
} from '@sigx/lynx';

/** Reactive controller returned by `useDrawer()`. */
export interface DrawerNav {
    /** True when the drawer is currently visible. Reactive. */
    readonly isOpen: boolean;
    /** Opens the drawer. */
    open(): void;
    /** Closes the drawer. */
    close(): void;
    /** Toggles between open and closed. */
    toggle(): void;
}

/**
 * Access the enclosing Drawer navigator. Throws when called outside
 * `<Drawer>`.
 */
export const useDrawer = defineInjectable<DrawerNav>(() => {
    throw new Error(
        '[lynx-navigation] useDrawer() called outside of a <Drawer> component.',
    );
});

type DrawerProps =
    & Define.Prop<'initialOpen', boolean>
    & Define.Slot<'sidebar'>
    & Define.Slot<'default'>;

export const Drawer = component<DrawerProps>(({ props, slots }) => {
    // `isOpenSig` uses the `{value}` wrapper pattern — sigx's `signal()` of
    // a primitive returns a proxy that requires `.value` reads; wrapping in
    // an object makes the proxy carry a mutable boolean.
    const isOpenSig: Signal<{ value: boolean }> = signal({
        value: props.initialOpen === true,
    });

    const nav: DrawerNav = {
        get isOpen() {
            return isOpenSig.value;
        },
        open() {
            isOpenSig.value = true;
        },
        close() {
            isOpenSig.value = false;
        },
        toggle() {
            isOpenSig.value = !isOpenSig.value;
        },
    };

    defineProvide(useDrawer, () => nav);

    return () => {
        const open = isOpenSig.value;
        return (
            <view style={{ width: '100%', height: '100%' }}>
                {/* Main content fills the whole parent. */}
                <view style={{ width: '100%', height: '100%' }}>
                    {slots.default?.()}
                </view>

                {/* Sidebar is overlaid; toggled via `display`. Apps that
                    want an animated slide-in wrap the sidebar themselves
                    — the navigator just controls visibility. */}
                <view
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        display: open ? 'flex' : 'none',
                    }}
                >
                    {slots.sidebar?.()}
                </view>
            </view>
        );
    };
});
