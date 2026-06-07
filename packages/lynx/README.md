# @sigx/lynx

**[SignalX](https://github.com/signalxjs/core) for [Lynx](https://lynxjs.org/)** lets you build native iOS and Android apps with SignalX's signal/effect reactivity model on top of ByteDance's Lynx runtime — with cross-thread gestures and animations that run on the device's main UI thread.

**`@sigx/lynx`** is the package you import from in app code. It bundles [`@sigx/reactivity`](https://github.com/signalxjs/core/tree/main/packages/reactivity) (state), [`@sigx/runtime-core`](https://github.com/signalxjs/core/tree/main/packages/runtime-core) (components, lifecycle), and [`@sigx/lynx-runtime`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-runtime) (the dual-thread renderer) behind one import path, so app code says `import { signal, component, useSharedValue } from '@sigx/lynx'` and nothing else.

## Highlights

- **Native, not WebView.** Real `UIView` / `View` trees. Video maps to `AVPlayer` / `ExoPlayer`, maps to `MKMapView` / Google Maps, gestures hit the actual touch system — no DOM wrapper, no JS bridge in the hot path.
- **Zero-config native modules.** `pnpm add @sigx/lynx-camera` → `sigx prebuild` → done. The autolinker wires Podfile, Gradle, `Info.plist`, `AndroidManifest.xml`, and the native module registry from each package's `signalx-module.json`. You never edit a `Podfile` to add a dependency.
- **`fetch` is just there.** Importing `@sigx/lynx` installs a global WHATWG `fetch` (plus `Headers` / `FormData` / `Response` / a `TextDecoder` shim) backed by [`@sigx/lynx-http`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-http) — URLSession / OkHttp underneath, `FormData` multipart uploads that stream picked-file bytes natively, upload progress, and streaming bodies (`res.body.getReader()` for SSE). The native side autolinks automatically; opt out with `excludeModules: ['@sigx/lynx-http']` in your `signalx.config.ts`.
- **Main-thread gestures & animations.** Press, drag, swipe, scroll offsets, and spring + tween animations all run on Lepus (the platform's main thread). Your finger tracks at the display's refresh rate even when JS is busy.
- **`SharedValue` — cross-thread state for free.** Mutate from a `'main thread'` worklet; read reactively from a SignalX `effect` on the background thread. Powers gestures, scroll, animation, and any custom "fast state lives on MT" use case. Not available in react-lynx or vue-lynx as of 2026-04.
- **Type-first navigation.** `defineRoutes` plus module augmentation gives every navigator API (`useNav`, `useParams`, `useSearch`, `<Link>`) precise per-route inference. Native Stack / Tabs / Drawer / modals.
- **A real native-module catalog.** Camera, audio, video, maps, webview, biometric, secure storage, file system, location, push + local notifications, share sheet, clipboard, haptics, image picker, websocket, connectivity, device info, background tasks, appearance, safe area — all auto-linked.
- **Dev experience that doesn't fight you.** `sigx dev` runs rspeedy with HMR and streams device `console.*` straight to your terminal. `sigx run:ios` / `sigx run:android` go from scaffold to a running app in one command. `sigx doctor` verifies your toolchain. On-device dev menu, error overlay, perf HUD, and QR scanner are debug-only and dropped from release builds.
- **Build pipeline that disappears.** The plugin runs the SWC `'main thread'` worklet transform automatically — including across third-party packages that ship directives in their `dist/`, with no allowlist. Tailwind preset + DaisyUI components + build-time icon tree-shaking (only glyphs you actually render ship in the bundle).
- **Testable.** [`@sigx/lynx-testing`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-testing) renders into an in-memory tree so component tests run under vitest like any other library — no Lynx runtime needed.

## Quick start

Scaffold a new app:

```bash
npm create @sigx@latest my-app
# pick: lynx (or lynx-tailwind)
cd my-app
pnpm install
pnpm dev
```

Then in another terminal:

```bash
pnpm run:ios       # or run:android
```

That's it. The template wires the build plugin, the CLI, and a starter `App.tsx`.

### Minimal app

```tsx
// src/App.tsx
import { component, signal } from '@sigx/lynx';

const App = component(() => {
    const count = signal(0);
    return () => (
        <view>
            <text>count = {count.value}</text>
            <view bindtap={() => { count.value++; }}>
                <text>tap me</text>
            </view>
        </view>
    );
});

export default App;
```

```tsx
// src/main.tsx
import { defineApp } from '@sigx/lynx';
import App from './App';

defineApp(<App />).mount(null);
```

### Build plugin

If you're integrating into an existing Lynx project rather than scaffolding, register the plugin in your rspeedy / rspack config:

```ts
// lynx.config.ts
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginSigxLynx } from '@sigx/lynx-plugin';

export default defineConfig({
    source: { entry: { main: './src/main.tsx' } },
    plugins: [pluginSigxLynx()],
});
```

The plugin handles the BG / MT bundle split and the `'main thread'` worklet transform.

## What you import

| Surface | Use for |
|---|---|
| `signal`, `effect`, `computed`, `batch`, `untrack`, `watch`, `effectScope` | Reactive state and computations (BG thread). |
| `component`, `defineApp`, `defineDirective`, `onMounted`, `onUnmounted`, `onUpdated`, `onCreated`, `provide` / `inject` | Component model, lifecycle, dependency injection. |
| `useMainThreadRef`, `MainThreadRef` | Refs whose `.current` value lives on the main UI thread. |
| `runOnMainThread`, `runOnBackground`, `transformToWorklet` | Cross-thread function calls. |
| `useSharedValue`, `SharedValue`, `SharedValueState` | The cross-thread primitive — MT-writable, BG-observable values. See below. |
| `useAnimatedStyle` | Bind an element style to a `SharedValue` via a named mapper (linear or range-mapped), applied on MT every flush. |
| `MainThread`, `Define`, `ViewAttributes`, … | JSX type annotations. |

## SharedValue — the cross-thread primitive

`useSharedValue<T>(initial)` returns a value you can **write from a main-thread worklet** and **read reactively from the background thread**.

It's not animation-specific. `SharedValue` is a general "fast state lives on the other thread" primitive — animation, gestures, scroll, sensors, layout are all parallel customers of the same bridge.

```tsx
import { useSharedValue } from '@sigx/lynx';
import { Draggable } from '@sigx/lynx-gestures';

const tx = useSharedValue(0);

<Draggable translateX={tx} />
<text>x = {tx.value}px</text>   // BG-reactive, updates per drag frame
```

The MT side mutates `tx.current.value` from inside a `'main thread'` worklet (zero-latency). On every `__FlushElementTree` boundary the runtime diffs registered values and dispatches a single batched event to BG, where each value lands in a SignalX `signal`. A BG `effect(() => sv.value)` re-runs reactively without injecting BG into the gesture hot path.

### Scroll-driven UI example

```tsx
import {
    useSharedValue, useAnimatedStyle, useMainThreadRef,
    type MainThread,
} from '@sigx/lynx';
import { ScrollView } from '@sigx/lynx-gestures';

const scrollY = useSharedValue(0);
const heroRef = useMainThreadRef<MainThread.Element | null>(null);

// Parallax: as scroll goes 0 → 300, the hero translates 0 → -150 px.
useAnimatedStyle(heroRef, scrollY, 'translateY', {
    inputRange: [0, 300],
    outputRange: [0, -150],
    extrapolate: 'clamp',
});

<ScrollView offsetY={scrollY}>
    <view main-thread:ref={heroRef}><image src={hero} /></view>
    <text>Body…</text>
    <text>Scroll position (BG-reactive): {scrollY.value.toFixed(0)}px</text>
</ScrollView>
```

Scroll → `<ScrollView>`'s MT worklet writes `scrollY.current.value` → flush triggers `useAnimatedStyle`'s mapper and applies the transform → MT publishes the diff to BG → `<text>` updates reactively. End-to-end, never crosses to BG inside the scroll hot path. The user just passes a `SharedValue` — same shape as `<Draggable translateX={tx}>`.

### Caveats

- **Not bidirectional.** Writes from BG (`sv.value = 100`) are no-op'd with a dev warning. Authoritative state lives on MT; BG observes.
- **Mappers register on MT.** Custom mappers must be registered from a MT-side module via `registerMapper(name, fn)` — BG-side `useAnimatedStyle` only carries the *name*.

## Networking out of the box

No import, no setup — `fetch` is global, like on the web:

```ts
const res = await fetch('https://api.example.com/items', {
    headers: { Authorization: `Bearer ${token}` },
});
const items = await res.json();
```

Multipart uploads (with `@sigx/lynx-file-picker` handles) and streaming/SSE consumption (`res.body.getReader()`) work too — see [`@sigx/lynx-http`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-http) for the full surface, spec deviations, and how the default wiring works. `WebSocket` and connectivity status remain separate installs ([`@sigx/lynx-websocket`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-websocket), [`@sigx/lynx-network`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-network)).

## The rest of the ecosystem

This package is the framework entry point. For the full list of native modules, UI packages, gestures, animation, navigation, icons, and dev tooling — see the [monorepo README](https://github.com/signalxjs/lynx#packages).

## License

MIT — © Andreas Ekdahl
