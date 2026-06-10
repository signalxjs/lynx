# @sigx/lynx-appearance

System color-scheme observer + status-bar / navigation-bar tint setters for sigx-lynx. The native publisher writes `lynx.__globalProps.appearance` before MT first paint, so the initial light/dark value is available on cold start with no flash; subsequent system flips publish through `GlobalEventEmitter` and update a BG signal.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/appearance/overview/](https://sigx.dev/lynx/modules/appearance/overview/)**

## Install

```bash
pnpm add @sigx/lynx-appearance
```

`sigx prebuild` auto-discovers the package, registers `AppearanceModule` / `AppearancePublisher` on both platforms, and wires the iOS host VC to forward `preferredStatusBarStyle` to the module so `setStatusBarStyle(...)` actually takes effect.

## Usage

Mount the provider once near the root, then read the color scheme reactively from any component:

```tsx
import { component, effect } from '@sigx/lynx';
import {
    AppearanceProvider,
    useSystemColorScheme,
    setSystemBarsStyle,
} from '@sigx/lynx-appearance';

const Root = component(() => () => (
    <AppearanceProvider>
        <App />
    </AppearanceProvider>
));

const App = component(() => {
    const scheme = useSystemColorScheme();

    // Keep the system bars in sync with the current scheme.
    effect(() => {
        void setSystemBarsStyle({
            statusBar: scheme.value === 'dark' ? 'light' : 'dark',
            statusBarBackground: scheme.value === 'dark' ? '#000' : '#fff',
            navigationBar: { style: scheme.value === 'dark' ? 'light' : 'dark' },
        });
    });

    return () => (
        <text>System is {scheme.value} mode</text>
    );
});
```

From inside a `'main thread'` worklet, use the sync variant — no subscription, reads `lynx.__globalProps` directly:

```ts
import { useSystemColorSchemeMT } from '@sigx/lynx-appearance';
// inside a main-thread worklet body:
const isDark = useSystemColorSchemeMT() === 'dark';
```

## API

| Surface | Use for |
|---|---|
| `AppearanceProvider` | Mount once near the root. Provides the live color-scheme signal to descendants. |
| `useSystemColorScheme()` | BG-side reactive read. Returns a signal of `'light' \| 'dark'`. Re-runs effects when the user flips dark mode in system settings. |
| `useSystemColorSchemeMT()` | MT-side sync read. Returns `'light' \| 'dark'` from `lynx.__globalProps`. For use inside `'main thread'` worklet bodies. |
| `setStatusBarStyle(style)` | Set status-bar *content* tint. `'light'` = light icons (legible on dark bg). |
| `setStatusBarBackgroundColor(color)` | **Android only** — status-bar background color (`null` clears). iOS resolves `{ ok: false, reason: 'unsupported' }`. |
| `setNavigationBarStyle({ style, color? })` | **Android only** — navigation-bar tint + optional background. iOS resolves `{ ok: false, reason: 'unsupported' }`. |
| `setSystemBarsStyle({ statusBar?, statusBarBackground?, navigationBar? })` | Convenience — apply all three in one deterministic call. Returns first non-`unsupported` failure, or `{ ok: true }`. |
| `isAvailable()` | Whether the native Appearance module is registered in the current build. |
| `APPEARANCE_EVENT` | The event name (`'appearanceChanged'`) fired by the native publishers. Exported so iOS / Android / JS agree on a single string. |

```ts
type ColorScheme = 'light' | 'dark';
type SystemBarStyle = 'light' | 'dark';
interface SetterResult {
    ok: boolean;
    /** Present when `ok === false` — e.g. `'unsupported'` on iOS for
     *  nav-bar / status-bar-background calls. */
    reason?: string;
}
```

All setters return `Promise<SetterResult>` and **never reject** — unwired platforms, web preview, SSR, and test runs all resolve to `{ ok: false, reason: 'unsupported' }`. You can therefore `void setSystemBarsStyle(...)` without risking unhandled rejections.

## Gotchas

- **iOS status-bar style needs host VC forwarding.** `setStatusBarStyle(...)` resolves successfully but won't visibly change anything unless the host view controller forwards `preferredStatusBarStyle` to `AppearanceModule.preferredStatusBarStyle`. The lynx-cli iOS template does this automatically; if you're integrating into an existing UIViewController, copy the forwarding pattern.
- **Android 15+ (API 35) edge-to-edge.** `setStatusBarBackgroundColor` is a no-op at the system level on API 35+ because edge-to-edge is enforced. Render your own background view inside the safe-area top padding instead — pairs naturally with [`@sigx/lynx-safe-area`](https://sigx.dev/lynx/modules/safe-area/overview/).
- **`'light'` vs `'dark'` is the *content* tint, not the background.** `style: 'light'` means "light-colored icons" (so a dark background behind them is legible). Easy to flip the wrong way the first time.
- **Cold-start value.** `readGlobalColorScheme()` reads the value the native publisher wrote before first paint. If it returns `null` (e.g. running on a host that didn't link the publisher), the hook seeds `'light'` as a safe default.

## License

MIT
