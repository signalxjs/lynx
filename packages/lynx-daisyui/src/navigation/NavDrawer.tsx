/**
 * `<NavDrawer>` — daisy-themed off-canvas drawer for `@sigx/lynx-navigation`.
 *
 * Composes the primitive `<Drawer>` purely as the state provider (so
 * `useDrawer()` resolves for descendants) and drives its own
 * `SharedValue`-backed slide + fade transition via `@sigx/lynx-motion`.
 *
 * Behavior:
 *  - Panel translates from off-screen on the configured `side` to `0`
 *    on open (and back on close). Default side is `'left'`.
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
} from '@sigx/lynx';
import { withTiming } from '@sigx/lynx-motion';
import { Drawer, useDrawer } from '@sigx/lynx-navigation';
import { resolveDaisyColor, type BackgroundValue } from '../shared/styles.js';

export type NavDrawerSide = 'left' | 'right';

export type NavDrawerProps =
    /** Which edge the panel slides in from. Default 'left'. */
    & Define.Prop<'side', NavDrawerSide, false>
    /** Panel surface color. Accepts daisy tokens ('base-100', 'primary', …)
     *  — applied as a `bg-<token>` Tailwind class so the daisy preset's
     *  CSS-pipeline rule resolves the `var(--color-<token>)`. Also accepts
     *  raw CSS color strings ('#facc15', 'rgb(...)') — applied as inline
     *  `backgroundColor`. Default 'base-100'. */
    & Define.Prop<'background', BackgroundValue, false>
    /** Show a separator line on the panel's inner edge. Default true. */
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
                side={props.side ?? 'left'}
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
    & Define.Prop<'side', NavDrawerSide, true>
    & Define.Prop<'background', BackgroundValue, true>
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
    const shouldRender = signal(drawer.isOpen);
    // Track whether the chrome is currently mounted (or animating out) so the
    // initial effect tick on a closed drawer doesn't kick a no-op close
    // animation + unmount timer.
    let chromeMounted = drawer.isOpen;
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
            chromeMounted = true;
            untrack(() => {
                shouldRender.value = true;
            });
            openAnim();
        } else if (chromeMounted) {
            chromeMounted = false;
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
        // else: drawer is closed and the chrome was never mounted (the
        // common initial-mount case) — nothing to animate or schedule.
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
                            // Key by side+width — `useAnimatedStyle`
                            // snapshots `outputRange` at setup, so a
                            // runtime change to either (panel slide
                            // distance is signed by side, magnitude by
                            // width) needs a remount + rebind. Width
                            // changes mid-open are vanishingly rare;
                            // toggling `side` likewise. The explicit
                            // remount keeps the binding consistent if
                            // a consumer wires either to a reactive
                            // value.
                            key={`drawer-chrome-${props.side}-${props.width}`}
                            side={props.side}
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
    & Define.Prop<'side', NavDrawerSide, true>
    & Define.Prop<'progress', SharedValue<number>, true>
    & Define.Prop<'width', number, true>
    & Define.Prop<'background', BackgroundValue, true>
    & Define.Prop<'bordered', boolean, true>
    & Define.Prop<'backdrop', boolean, true>
    & Define.Prop<'renderSidebar', (() => JSXElement | JSXElement[]) | undefined, false>
    & Define.Prop<'onBackdropPress', () => void, true>;

const DrawerChrome = component<DrawerChromeProps>(({ props }) => {
    const panelRef = useMainThreadRef<MainThread.Element | null>(null);
    const backdropRef = useMainThreadRef<MainThread.Element | null>(null);

    // Slide range mirrors `side`: left-side starts at `-width` (off-screen
    // left) and lands at `0`; right-side starts at `+width` and lands at `0`.
    // Capture once — NavDrawerShell remounts on side/width change to rebind.
    const closedTx = props.side === 'right' ? props.width : -props.width;

    // Bind once at setup. `useAnimatedStyle` snapshots its mapper/range
    // params at registration time; NavDrawerShell keys DrawerChrome by
    // side+width so a change to either forces a remount + rebind here.
    useAnimatedStyle(panelRef, props.progress, 'translateX', {
        inputRange: [0, 1],
        outputRange: [closedTx, 0],
    });

    // Register unconditionally so a runtime `backdrop` toggle works
    // both directions. `useAnimatedStyle` only binds once at setup; if
    // this lived inside `if (props.backdrop)` a false→true toggle would
    // mount a backdrop view with no opacity binding, leaving it stuck
    // at the inline `opacity: 0` seed. When the backdrop view isn't
    // rendered, `backdropRef.current` is null and the MT bridge's
    // `setStyleProperties` apply silently skips — no harm.
    useAnimatedStyle(backdropRef, props.progress, 'opacity', {
        inputRange: [0, 1],
        outputRange: [0, BACKDROP_OPACITY],
    });

    return () => {
        const isRight = props.side === 'right';
        // Lynx resolves `var(--color-*)` inside CSS-pipeline rules (Tailwind
        // classes, stylesheet imports) but NOT inside inline `style.backgroundColor`
        // — an inline `'var(--color-base-100)'` paints transparent. So for known
        // daisy tokens we apply the surface via the Tailwind class `bg-<token>`
        // (which the daisy preset compiles to a `var()` rule that DOES resolve);
        // raw CSS strings ('#facc15', 'rgb(...)', 'var(--my-custom)') fall through
        // to inline because there's no compiled class to use for them.
        const resolved = resolveDaisyColor(props.background);
        const isDaisyToken = resolved !== props.background;
        const bgClass = isDaisyToken ? `bg-${props.background}` : '';
        // Border lives on the panel's *inner* edge (the one facing the
        // main content). Daisy class names are still the cleanest way to
        // pick up `--color-base-300` for the separator hairline.
        const borderClass = props.bordered
            ? (isRight ? 'border-l border-base-300' : 'border-r border-base-300')
            : '';
        const panelClass = [bgClass, borderClass].filter(Boolean).join(' ');
        const panelStyle: Record<string, string | number> = {
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: props.width,
        };
        if (!isDaisyToken) panelStyle.backgroundColor = props.background;
        // Only the side-relevant inset is set; omitting the other lets
        // the panel size to `width` rather than stretching edge-to-edge.
        if (isRight) panelStyle.right = 0;
        else panelStyle.left = 0;

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
                    style={panelStyle}
                >
                    {props.renderSidebar?.()}
                </view>
            </view>
        );
    };
});
