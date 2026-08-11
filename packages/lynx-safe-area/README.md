# @sigx/lynx-safe-area

Safe-area insets (notch, home indicator, status bar, navigation bar, keyboard) for sigx-lynx. A native publisher on iOS + Android emits insets every time they change; the JS side surfaces them as a reactive BG signal, four per-edge `SharedValue`s for MT-driven layout, and CSS variables for utility-class styling.

Mirrors React Native's `react-native-safe-area-context` API where it makes sense, but built for sigx-lynx's two-thread model so layout-bound insets don't bounce through the bridge.

## 📚 Documentation

Full API, hooks, CSS variables and live examples → **[sigx.dev/lynx/modules/safe-area/overview](https://sigx.dev/lynx/modules/safe-area/overview/)**

## Install

```bash
pnpm add @sigx/lynx-safe-area
```

`sigx prebuild` auto-discovers the package, copies the native `SafeAreaPublisher` into your `ios/` and `android/` trees, and registers it so insets attach to every `LynxView` before first paint. No additional native wiring required.

## Usage

Wrap your app once, anywhere above the views that need insets:

```tsx
import { defineApp } from '@sigx/lynx';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';

const App = () => (
    <SafeAreaProvider>
        <SafeAreaView edges={['top', 'bottom']} class="bg-base-100">
            <PageContent />
        </SafeAreaView>
    </SafeAreaProvider>
);

defineApp(<App />).mount(null);
```

`<SafeAreaView>` reactively applies the current insets as padding (or margin) to the configured edges, seeded synchronously on first paint so there's no flash of unsafe content.

## API

| Export | Signature | Notes |
| --- | --- | --- |
| `SafeAreaProvider` | `<SafeAreaProvider class? style?>` | Mount once at the root. Seeds insets synchronously from `lynx.__globalProps`, owns the four per-edge `SharedValue`s, and subscribes to the native `safeAreaChanged` event. |
| `SafeAreaView` | `<SafeAreaView edges? mode? class? style?>` | Applies the insets to `edges` (default: all four) as `mode` — `'padding'` (default) or `'margin'`. Fills its parent by default (`flexGrow: 1; flexBasis: 0`). |
| `useSafeAreaInsets()` | `→ PrimitiveSignal<EdgeInsets> \| Computed<EdgeInsets>` | BG-side reactive read; the component re-renders on rotation, keyboard and split-view changes. Outside a provider it returns a `ZERO_INSETS` signal and warns in dev rather than throwing. |
| `useSafeAreaSharedValues()` | `→ { top, right, bottom, left }: SharedValue<number>` (or `null`) | The MT-driven path — bind these in `useAnimatedStyle` to move layout without a BG re-render. `null` outside a provider. |
| `useSafeAreaFrame(w, h)` | `→ Computed<{ x, y, width, height }>` | The visible content rect in dp/pt, for absolute overlays and modal bounds. Width/height are derived from the viewport size you pass. **Under-reports the height while the keyboard is up** — see Gotchas. |
| `useSafeAreaInsetsMT()` | `→ EdgeInsets` | Synchronous read for `'main thread'` worklet bodies. Not reactive — it re-reads `lynx.__globalProps` per invocation. |
| `useSafeAreaContext()` | `→ SafeAreaContextValue \| null` | The raw injectable, for composing your own hook. |
| `readGlobalSafeArea()` | `→ EdgeInsets` | Provider-free synchronous read of the globalProps key; works on both threads. Falls back to `ZERO_INSETS`. |
| `ZERO_INSETS` | `EdgeInsets` | The all-zero record used as the fallback everywhere above. |
| `GLOBAL_PROPS_KEY` / `SAFE_AREA_EVENT` | `string` | The `__globalProps` key and native event name — exported for tests and for a host that publishes insets itself. |

```ts
interface EdgeInsets {
    top: number; right: number; bottom: number; left: number;   // dp/pt, CSS order
    keyboard: number;        // IME height when visible, else 0
    statusBar: number;       // top system bar; smaller than `top` on a notched device
    navigationBar: number;   // Android gesture / 3-button nav bar
}

type Edge = 'top' | 'right' | 'bottom' | 'left';
type SafeAreaMode = 'padding' | 'margin';
```

The CSS variables (`--sat` / `--sar` / `--sab` / `--sal`) are declared by the provider for utility-class styling; the full architecture is on the docs site.

## Web

**Runs on web (`sigx run:web`), but every inset is zero.** The JS side is pure JS and nothing here throws: `<SafeAreaProvider>` and `<SafeAreaView>` render, the hooks return live signals, and the CSS variables are declared as usual. The values, however, come from the native `SafeAreaPublisher` writing `lynx.__globalProps.safeArea`, and `@sigx/lynx-web-host` publishes no such key — so `readGlobalSafeArea()` falls back to `ZERO_INSETS` and stays there (no `safeAreaChanged` event ever arrives).

That's the right answer for an ordinary browser viewport, but not for an installed PWA on a notched phone. A web shim would publish the browser's `env(safe-area-inset-*)` values (plus `visualViewport` for the keyboard) into the same globalProps key; that isn't wired today.

## Gotchas

- **No provider is not an error.** `useSafeAreaInsets()` outside `<SafeAreaProvider>` returns a `ZERO_INSETS` signal and warns in dev instead of throwing, so an app fragment mounted in a test or a storybook renders rather than crashing. If your padding is mysteriously zero on device, check the provider is above the view.
- **`useSafeAreaFrame` under-reports its height while the keyboard is up.** It computes `viewportHeight - top - bottom - keyboard`, but the keyboard covers the home-indicator region — which is why a lift is `max(0, keyboard - bottomInset)` everywhere else in the stack — so the bottom inset is counted twice and the frame comes out short by that much. Subtract it yourself if you need the exact rect with an IME open; the fix is tracked on [#902](https://github.com/signalxjs/lynx/issues/902).
- **`useSafeAreaFrame` needs the viewport passed in.** It has no way to read the window size itself, so both arguments are required — read them once from `DeviceInfo.getInfo()` (or `useScreen()` from `@sigx/lynx-core`, which also follows rotation).
- **`<SafeAreaView>` fills its parent.** It sets `flexGrow: 1; flexShrink: 1; flexBasis: 0` because Lynx, like React Native, resolves the `flex: 1` shorthand's basis to `auto` — which sizes to content and collapses the chain, leaving bottom chrome floating mid-screen. Override via `style` if you need a content-sized box.
- **Insets are applied as inline style, not an MT animated style.** `setStyleProperties` writes that affect layout land *after* the first layout pass, and children that have already measured — `<scroll-view>` captures its frame eagerly — don't reflow. If you drive your own layout from `useSafeAreaSharedValues()`, expect the same trap.
- **`statusBar` / `navigationBar` / `keyboard` are informational.** They're populated where the platform exposes them and are `0` otherwise; only `top`/`right`/`bottom`/`left` are guaranteed on both platforms.
- **Won't do: per-edge inset *modes*.** `react-native-safe-area-context` lets each edge pick `'additive' | 'maximum' | 'off'`; here `mode` is per-view. Deferred rather than refused — it changes the `edges` prop's shape.

## License

MIT
