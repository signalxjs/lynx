/**
 * `<StatusBarSync />` — keeps the device status-bar (and Android's
 * navigation-bar) tint legible against the active daisyui theme.
 *
 * Reads the current theme via `useTheme()`, looks up its variant in the
 * theme registry, and pushes the appropriate tint to the OS via
 * `@sigx/lynx-appearance`:
 *
 *   light theme → dark status-bar icons (legible against light bg)
 *   dark  theme → light status-bar icons (legible against dark bg)
 *
 * Mount once, inside `<ThemeProvider>`:
 *
 * ```tsx
 * <ThemeProvider>
 *   <StatusBarSync />
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * Renders nothing — it's a side-effect-only component that drives a
 * reactive `effect()` reading `theme.name`. The `matchBackground` prop is
 * reserved for a follow-up that pushes the active theme's
 * `--color-base-100` as the Android system-bar background; today it's a
 * declared no-op so the API surface is stable across the rev that wires
 * CSS-var resolution.
 */
import { component, effect, onMounted, onUnmounted, type Define } from '@sigx/lynx';
import { isAvailable, setSystemBarsStyle } from '@sigx/lynx-appearance';
import type { SystemBarStyle } from '@sigx/lynx-appearance';
import { useTheme } from './ThemeProvider.js';
import { variantOf } from './registry.js';

export type StatusBarSyncProps =
    /**
     * Reserved — will (in a follow-up) push the active theme's
     * `--color-base-100` as the Android status- and navigation-bar
     * background. Currently a no-op; the prop ships so consumers can opt
     * in without an API break later. iOS and Android 15+ ignore the
     * background regardless (no equivalent on iOS; edge-to-edge on
     * Android 15+).
     */
    & Define.Prop<'matchBackground', boolean, false>;

export const StatusBarSync = component<StatusBarSyncProps>(({ props }) => {
    const theme = useTheme();
    let lastApplied: string | null = null;
    let runner: { stop: () => void } | undefined;

    function apply(name: string): void {
        if (name === lastApplied) return;
        lastApplied = name;
        const variant = variantOf(name);
        // For unregistered themes we can't infer a variant — leave the
        // system bars alone. Consumers can register their custom theme via
        // `registerTheme()` to opt in.
        if (!variant) return;
        const style: SystemBarStyle = variant === 'dark' ? 'light' : 'dark';
        // Fire-and-forget: `setSystemBarsStyle` is non-throwing (it
        // resolves `{ ok: false, reason: 'unsupported' }` when the native
        // module isn't registered, and silently filters per-leg
        // `unsupported` results — e.g. nav-bar on iOS — so an aggregate
        // `ok: true` is still reachable on partial platforms). Either way,
        // void-discarding the promise here can't surface as an unhandled
        // rejection.
        void setSystemBarsStyle({
            statusBar: style,
            navigationBar: { style },
        });
    }

    onMounted(() => {
        if (!isAvailable()) return;
        // A reactive effect that reads `theme.name` so the effect re-runs
        // whenever the theme controller's underlying signal changes —
        // including the live system-flip path inside ThemeProvider. No
        // side effects in render; nothing to subscribe/unsubscribe by
        // hand.
        runner = effect(() => {
            apply(theme.name);
        });
    });

    onUnmounted(() => {
        runner?.stop();
        runner = undefined;
    });

    // Reference the prop so the type checker doesn't flag it as unused
    // while it's still reserved. Drop this when the matchBackground
    // implementation lands.
    void props.matchBackground;

    // Zero-size, out-of-flow placeholder. Avoids `display: none` —
    // Lynx can leak unstyled text paint through display:none overlays in
    // some builds (see lynx-display-none caveat); zero-size + absolute is
    // the safer shape.
    return () => (
        <view style={{ position: 'absolute', width: '0px', height: '0px', opacity: 0 }} />
    );
});
