/**
 * `<NavDrawer>` — HeroUI-themed off-canvas drawer for `@sigx/lynx-navigation`.
 *
 * Composes the primitive `<Drawer>` as the state provider (so `useDrawer()`
 * resolves for descendants) and drives its own `SharedValue`-backed slide +
 * fade via `@sigx/lynx-motion`:
 *  - Panel translates from off-screen on `side` to 0 on open (back on close).
 *  - Backdrop fades 0 → 0.3 in tandem.
 *  - Chrome mounts on open and unmounts after the exit animation, so a closed
 *    drawer doesn't intercept taps.
 *
 * ```tsx
 * <NavigationRoot routes={routes}>
 *   <NavDrawer slots={{ sidebar: () => <MyMenu /> }}>
 *     <Stack />
 *   </NavDrawer>
 * </NavigationRoot>
 * ```
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
import { resolveColorToken, type BackgroundValue } from '@sigx/lynx-zero';

export type NavDrawerSide = 'left' | 'right';

export type NavDrawerProps =
    /** Which edge the panel slides in from. Default 'left'. */
    & Define.Prop<'side', NavDrawerSide, false>
    /** Panel surface color. Semantic tokens ('base-100', 'primary', …) apply as
     *  a `bg-<token>` class (the preset compiles it to a resolvable `var()`
     *  rule); raw CSS strings apply inline. Default 'base-100'. */
    & Define.Prop<'background', BackgroundValue, false>
    /** Show a separator on the panel's inner edge. Default true. */
    & Define.Prop<'bordered', boolean, false>
    /** Dismiss-on-tap scrim over the main content when open. Default true. */
    & Define.Prop<'backdrop', boolean, false>
    /** Panel width in pixels. Default 280. */
    & Define.Prop<'width', number, false>
    /** Open at mount. Default false. Passthrough to the primitive `<Drawer>`. */
    & Define.Prop<'initialOpen', boolean, false>
    /** Drawer panel contents — your menu UI. */
    & Define.Slot<'sidebar'>
    /** Main content — usually a `<Stack>` or `<Tabs>`. */
    & Define.Slot<'default'>;

const ENTER_DURATION_SEC = 0.28;
const EXIT_DURATION_SEC = 0.22;
// `ceil` so the unmount timer never fires before the exit animation finishes
// (which would pop the panel/backdrop out instead of letting it slide).
const EXIT_DURATION_MS = Math.ceil(EXIT_DURATION_SEC * 1000);

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
    const progress = useSharedValue(drawer.isOpen ? 1 : 0);
    const shouldRender = signal(drawer.isOpen);
    let chromeMounted = drawer.isOpen;
    let exitTimer: ReturnType<typeof setTimeout> | null = null;

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
            // Wait for the exit animation before unmounting the chrome — else the
            // panel pops out instead of sliding, and the backdrop tap area
            // disappears mid-fade.
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

    return () => (
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
                        // `useAnimatedStyle` snapshots its range at setup, so a
                        // runtime side/width change needs a remount + rebind.
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

    // Left starts at `-width` (off-screen) and lands at 0; right at `+width`.
    const closedTx = props.side === 'right' ? props.width : -props.width;

    useAnimatedStyle(panelRef, props.progress, 'translateX', {
        inputRange: [0, 1],
        outputRange: [closedTx, 0],
    });

    // Registered unconditionally so a runtime `backdrop` toggle binds both ways;
    // when the backdrop view isn't rendered the ref is null and the apply skips.
    useAnimatedStyle(backdropRef, props.progress, 'opacity', {
        inputRange: [0, 1],
        outputRange: [0, BACKDROP_OPACITY],
    });

    return () => {
        const isRight = props.side === 'right';
        // `resolveColorToken` rewrites a semantic token to `var(--color-*)` and
        // passes raw CSS values through unchanged. We use that only to branch:
        // semantic tokens apply via the `bg-<token>` class (the preset compiles
        // it to a resolvable rule); raw CSS color strings apply inline.
        const resolved = resolveColorToken(props.background);
        const isToken = resolved !== props.background;
        const bgClass = isToken ? `bg-${props.background}` : '';
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
        if (!isToken) panelStyle.backgroundColor = props.background;
        if (isRight) panelStyle.right = 0;
        else panelStyle.left = 0;

        return (
            <view style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                {props.backdrop
                    ? (
                        <view
                            main-thread:ref={backdropRef}
                            bindtap={() => props.onBackdropPress()}
                            class="bg-base-content"
                            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0 }}
                            accessibility-element={true}
                            accessibility-label="Close drawer"
                            accessibility-trait="button"
                        />
                    )
                    : null}
                <view main-thread:ref={panelRef} class={panelClass} style={panelStyle}>
                    {props.renderSidebar?.()}
                </view>
            </view>
        );
    };
});
