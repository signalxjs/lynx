/**
 * `<NavDrawer>` — daisy-themed off-canvas drawer for `@sigx/lynx-navigation`.
 *
 * Composes the primitive `<Drawer>` purely as the state provider (so
 * `useDrawer()` resolves for descendants) and drives its own
 * `SharedValue`-backed slide + fade transition via `@sigx/lynx-motion`.
 *
 * Behavior:
 *  - Panel translates from `-width` to `0` on open and back on close.
 *  - Backdrop fades 0 → 0.3 in tandem.
 *  - Chrome mounts on open and unmounts after the exit animation completes,
 *    so the closed-state drawer doesn't intercept taps to underlying tabs.
 *  - Backdrop is a plain `<view bindtap>` — no Pressable scale/opacity
 *    feedback (which flickers an opaque scrim).
 *
 * Usage:
 *
 * ```tsx
 * <NavigationRoot routes={routes}>
 *   <NavDrawer slots={{ sidebar: () => <MyMenu /> }}>
 *     <Stack />
 *   </NavDrawer>
 * </NavigationRoot>
 * ```
 *
 * Inside descendants, `useDrawer()` from `@sigx/lynx-navigation` returns
 * `{ isOpen, open, close, toggle }`.
 *
 * The primitive's own `<Drawer />` is intentionally minimal (state +
 * `display: none` overlay only); this component is the
 * batteries-included variant for daisyui consumers.
 */
import {
    component,
    effect,
    onUnmounted,
    runOnMainThread,
    signal,
    untrack,
    useAnimatedStyle,
    useMainThreadRef,
    useSharedValue,
    type Define,
    type JSXElement,
    type MainThread,
    type SharedValue,
    type Signal,
} from '@sigx/lynx';
import { withTiming } from '@sigx/lynx-motion';
import { Drawer, useDrawer } from '@sigx/lynx-navigation';

export type NavDrawerBackground = 'base-100' | 'base-200' | 'base-300' | 'transparent';

export type NavDrawerProps =
    /** Panel surface color token. Default 'base-100'. */
    & Define.Prop<'background', NavDrawerBackground, false>
    /** Show a separator line on the panel's trailing edge. Default true. */
    & Define.Prop<'bordered', boolean, false>
    /** Render a dismiss-on-tap scrim over the main content when open. Default true. */
    & Define.Prop<'backdrop', boolean, false>
    /** Panel width in pixels. Default 280. */
    & Define.Prop<'width', number, false>
    /** Open the drawer at mount. Default false. Passthrough to primitive `<Drawer>`. */
    & Define.Prop<'initialOpen', boolean, false>
    /** Drawer panel contents — your menu UI. */
    & Define.Slot<'sidebar'>
    /** Main content — usually a `<Stack>` or `<Tabs>`. */
    & Define.Slot<'default'>;

const backgroundClass: Record<NavDrawerBackground, string> = {
    'base-100': 'bg-base-100',
    'base-200': 'bg-base-200',
    'base-300': 'bg-base-300',
    'transparent': '',
};

/**
 * Slide-in / fade-in timing. Slightly longer than the slide-out so the
 * drawer feels deliberate on open and snappy on dismiss — matches the
 * convention used by Stack's push/pop transitions in `lynx-navigation`.
 */
const ENTER_DURATION_SEC = 0.28;
const EXIT_DURATION_SEC = 0.22;
const EXIT_DURATION_MS = Math.round(EXIT_DURATION_SEC * 1000);

const BACKDROP_OPACITY = 0.3;

export const NavDrawer = component<NavDrawerProps>(({ props, slots }) => {
    return () => (
        <Drawer initialOpen={props.initialOpen}>
            <NavDrawerShell
                background={props.background ?? 'base-100'}
                bordered={props.bordered ?? true}
                backdrop={props.backdrop ?? true}
                width={props.width ?? 280}
                renderSidebar={slots.sidebar}
            >
                {slots.default?.()}
            </NavDrawerShell>
        </Drawer>
    );
});

type NavDrawerShellProps =
    & Define.Prop<'background', NavDrawerBackground, true>
    & Define.Prop<'bordered', boolean, true>
    & Define.Prop<'backdrop', boolean, true>
    & Define.Prop<'width', number, true>
    & Define.Prop<'renderSidebar', (() => JSXElement | JSXElement[]) | undefined, false>
    & Define.Slot<'default'>;

const NavDrawerShell = component<NavDrawerShellProps>(({ props, slots }) => {
    const drawer = useDrawer();
    // Seed progress from current open state so `initialOpen=true` mounts
    // already-open without a slide-in flash.
    const progress = useSharedValue(drawer.isOpen ? 1 : 0);
    // `{ value }` wrapper — sigx's `signal()` over primitives returns a
    // proxy that requires `.value` reads, but writing a raw boolean to it
    // is brittle; wrapping in an object keeps `.value` as a mutable field.
    const shouldRender: Signal<{ value: boolean }> = signal({ value: drawer.isOpen });
    let exitTimer: ReturnType<typeof setTimeout> | null = null;

    // Pre-register the worklets at setup so the SWC main-thread transform
    // captures `progress` once. Re-registering on every effect tick would
    // re-ship the worklet body across the bridge unnecessarily.
    const openAnim = runOnMainThread(() => {
        'main thread';
        withTiming(progress, 1, { duration: ENTER_DURATION_SEC });
    });
    const closeAnim = runOnMainThread(() => {
        'main thread';
        withTiming(progress, 0, { duration: EXIT_DURATION_SEC });
    });

    const animRunner = effect(() => {
        const open = drawer.isOpen;
        if (open) {
            if (exitTimer != null) {
                clearTimeout(exitTimer);
                exitTimer = null;
            }
            untrack(() => {
                shouldRender.value = true;
            });
            openAnim();
        } else {
            closeAnim();
            // Wait for the exit animation to finish before unmounting the
            // chrome — otherwise the panel pops out instead of sliding,
            // and the backdrop's bindtap area disappears mid-fade.
            exitTimer = setTimeout(() => {
                untrack(() => {
                    shouldRender.value = false;
                });
                exitTimer = null;
            }, EXIT_DURATION_MS);
        }
    });

    onUnmounted(() => {
        animRunner.stop();
        if (exitTimer != null) clearTimeout(exitTimer);
    });

    return () => {
        return (
            <view
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                }}
            >
                {slots.default?.()}
                {shouldRender.value
                    ? (
                        <DrawerChrome
                            progress={progress}
                            width={props.width}
                            background={props.background}
                            bordered={props.bordered}
                            backdrop={props.backdrop}
                            renderSidebar={props.renderSidebar}
                            onBackdropPress={() => drawer.close()}
                        />
                    )
                    : null}
            </view>
        );
    };
});

type DrawerChromeProps =
    & Define.Prop<'progress', SharedValue<number>, true>
    & Define.Prop<'width', number, true>
    & Define.Prop<'background', NavDrawerBackground, true>
    & Define.Prop<'bordered', boolean, true>
    & Define.Prop<'backdrop', boolean, true>
    & Define.Prop<'renderSidebar', (() => JSXElement | JSXElement[]) | undefined, false>
    & Define.Prop<'onBackdropPress', () => void, true>;

const DrawerChrome = component<DrawerChromeProps>(({ props }) => {
    const panelRef = useMainThreadRef<MainThread.Element | null>(null);
    const backdropRef = useMainThreadRef<MainThread.Element | null>(null);

    // Bind once at setup. `useAnimatedStyle` snapshots its mapper/range
    // params at registration time; props are stable for this component's
    // lifetime (NavDrawerShell only remounts DrawerChrome on close).
    useAnimatedStyle(panelRef, props.progress, 'translateX', {
        inputRange: [0, 1],
        outputRange: [-props.width, 0],
    });

    if (props.backdrop) {
        useAnimatedStyle(backdropRef, props.progress, 'opacity', {
            inputRange: [0, 1],
            outputRange: [0, BACKDROP_OPACITY],
        });
    }

    return () => {
        const bg = backgroundClass[props.background];
        const border = props.bordered ? 'border-r border-base-300' : '';
        const panelClass = [bg, border].filter(Boolean).join(' ');

        return (
            <view
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                }}
            >
                {props.backdrop
                    ? (
                        <view
                            main-thread:ref={backdropRef}
                            bindtap={() => props.onBackdropPress()}
                            class="bg-base-content"
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                opacity: 0,
                            }}
                            accessibility-element={true}
                            accessibility-label="Close drawer"
                            accessibility-trait="button"
                        />
                    )
                    : null}
                <view
                    main-thread:ref={panelRef}
                    class={panelClass}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        bottom: 0,
                        width: props.width,
                    }}
                >
                    {props.renderSidebar?.()}
                </view>
            </view>
        );
    };
});
