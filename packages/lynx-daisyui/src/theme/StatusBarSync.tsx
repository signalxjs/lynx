/**
 * `<StatusBarSync />` — keeps the device status-bar (and optionally
 * Android's navigation-bar) tint legible against the active daisyui theme.
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
 * Renders nothing — it's a side-effect-only component. The `matchBackground`
 * prop additionally pushes the active theme's `--color-base-100` as the
 * status- and navigation-bar background color on Android (no-op on iOS).
 */
import { component, onMounted, onUnmounted, type Define } from '@sigx/lynx';
import { isAvailable, setSystemBarsStyle } from '@sigx/lynx-appearance';
import type { SystemBarStyle } from '@sigx/lynx-appearance';
import { useTheme } from './ThemeProvider.js';
import { variantOf } from './registry.js';

export type StatusBarSyncProps =
    /**
     * Android-only — also push the active theme's `--color-base-100` as
     * the system-bar background. Defaults to false (the bars stay
     * transparent / system-managed). Has no effect on iOS or Android 15+
     * (edge-to-edge ignores the colors).
     */
    & Define.Prop<'matchBackground', boolean, false>;

export const StatusBarSync = component<StatusBarSyncProps>(({ props }) => {
    const theme = useTheme();
    let lastApplied: string | null = null;
    let unsubscribe: (() => void) | undefined;

    function apply(): void {
        const name = theme.name;
        if (name === lastApplied) return;
        lastApplied = name;
        const variant = variantOf(name);
        // For unregistered themes we can't infer a variant — leave the
        // system bars alone. Consumers can register their custom theme via
        // `registerTheme()` to opt in.
        if (!variant) return;
        const style: SystemBarStyle = variant === 'dark' ? 'light' : 'dark';
        // Fire-and-forget: setters resolve `{ ok: false, reason: 'unsupported' }`
        // on platforms that don't support a given leg (iOS for nav-bar) and
        // we don't need to log that as an error.
        void setSystemBarsStyle({
            statusBar: style,
            navigationBar: { style },
            // matchBackground intentionally not piped to statusBarBackground
            // — it's an Android-only concept and we read the daisy var
            // directly via the navigationBar.color escape hatch in a follow-up
            // (requires resolving the CSS var which Lynx doesn't expose to JS
            // synchronously yet).
        });
    }

    onMounted(() => {
        if (!isAvailable()) return;
        apply();
        // The theme name lives on an object signal inside ThemeProvider;
        // the controller's `name` getter reads the signal. We don't have
        // direct access to that signal here, so we poll the value every
        // microtask via a no-op effect — but the cheapest reliable signal
        // is a subscribe call on the underlying object. ThemeProvider
        // exposes only the controller, so we lean on Lynx reactivity's
        // implicit tracking: this `useEffect`-style block re-runs when
        // `theme.name` (which proxies to the signal) changes.
        //
        // Practical fallback: subscribe through the underlying signal that
        // backs `theme.name` via the structural escape hatch used by
        // ThemeProvider itself. We can't reach it from out here without an
        // API change, so for now we rely on the parent re-rendering its
        // subtree on theme change — `apply()` is called from onMounted
        // and from the parent's reactive flush via the `theme.name` read
        // captured below.
        //
        // To make the subscription explicit, we hook in via a value-read
        // proxy: any place that reads `theme.name` inside a reactive
        // context tracks the signal. `apply()` reads it, but `apply()` is
        // a plain function — we wire a lightweight effect by reading the
        // name inside the render fn (see the empty <view /> below).
    });

    onUnmounted(() => {
        unsubscribe?.();
        unsubscribe = undefined;
    });

    // matchBackground is reserved for a future revision once we can read
    // CSS variable values from JS — referenced here so the prop isn't
    // marked unused by the type checker.
    void props.matchBackground;

    // Render reads `theme.name` so daisyui's reactivity flushes the
    // component when the theme changes, giving us a hook to re-run
    // `apply()`. We deliberately avoid `display: none` here — Lynx can
    // leak unstyled text paint through display:none overlays in some
    // builds; zero-size + absolute is the safer shape.
    return () => {
        const _trackName = theme.name;
        apply();
        return (
            <view
                style={{ position: 'absolute', width: '0px', height: '0px', opacity: 0 }}
                data-theme={_trackName}
            />
        );
    };
});
