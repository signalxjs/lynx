# @sigx/lynx

**[SignalX](https://sigx.dev/core/) for [Lynx](https://lynxjs.org/)** lets you build native iOS and Android apps with SignalX's signal/effect reactivity model on top of ByteDance's Lynx runtime — with cross-thread gestures and animations that run on the device's main UI thread.

**`@sigx/lynx`** is the package you import from in app code. It bundles [`@sigx/reactivity`](https://sigx.dev/core/packages/reactivity/overview/) (state), [`@sigx/runtime-core`](https://sigx.dev/core/packages/runtime-core/overview/) (components, lifecycle), and [`@sigx/lynx-runtime`](https://sigx.dev/lynx/modules/runtime/overview/) (the dual-thread renderer) behind one import path, so app code says `import { signal, component, useSharedValue } from '@sigx/lynx'` and nothing else.

## 📚 Documentation

Full guides, the complete module catalog, API reference and live examples → **[sigx.dev/lynx](https://sigx.dev/lynx/)**

## Why it's interesting

- **Native, not WebView.** Real `UIView` / `View` trees. Video maps to `AVPlayer` / `ExoPlayer`, maps to `MKMapView` / Google Maps, gestures hit the actual touch system — no DOM wrapper, no JS bridge in the hot path.
- **Zero-config native modules.** `pnpm add @sigx/lynx-camera` → `sigx prebuild` → done. The autolinker wires Podfile, Gradle, `Info.plist`, `AndroidManifest.xml`, and the native module registry from each package's `signalx-module.json`.
- **Main-thread gestures & animations.** Press, drag, swipe, scroll offsets, and spring + tween animations all run on Lepus (the platform's main thread), so your finger tracks at the display's refresh rate even when JS is busy.
- **`SharedValue` — cross-thread state for free.** Mutate from a `'main thread'` worklet; read reactively from a SignalX `effect` on the background thread. Powers gestures, scroll, animation, and any custom "fast state lives on MT" use case.
- **`fetch` is just there.** Importing `@sigx/lynx` installs a global WHATWG `fetch` backed by native URLSession / OkHttp, plus a built-in leveled, namespaced logger that streams to the `sigx dev` terminal.
- **A real native-module catalog.** Camera, audio, video, maps, webview, biometric, secure storage, file system, location, notifications, share, clipboard, haptics, image picker, websocket, and more — all auto-linked.

## Quick start

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

A minimal component:

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

The template wires the build plugin, the CLI, and a starter app for you.

## The rest of the ecosystem

This package is the framework entry point. For the full list of native modules, UI packages, gestures, animation, navigation, icons, and dev tooling — see the [module catalog on sigx.dev](https://sigx.dev/lynx/).

## Web

Supported as a build target — with one hole: the networking surface this package re-exports does not work in a browser. The framework itself contributes no native code (its `signalx-module.json` only marks the package for the autolink walk), so `sigx run:web` / `sigx build:web` build the same app for upstream `@lynx-js/web-core`: background code in a Web Worker, main-thread code in a hidden iframe, behind a host page wired to the `@sigx/lynx-web-host` bridge. There `Platform.OS` is `'web'`, the build-time `__WEB__` / `__NATIVE__` defines fold per environment, and a `Foo.web.tsx` sibling wins over `Foo.tsx`. That same file-extension swap is how each native module ships web support, so check the **Web** section of a module's own README before assuming it works in the browser — a module with no web shim and no handler in the page bridge isn't registered at all there.

**`fetch` is the exception — it does not work on web.** The `fetch` / `Headers` / `FormData` / `Response` re-exported here come from `@sigx/lynx-http`, which ships no web shim: on web the native `Http` module isn't registered, so its `fetch()` rejects with the "module not available" error. And importing `@sigx/lynx` runs that package's side-effect install, which *replaces* `globalThis.fetch` / `Headers` / `FormData` / `Response` whenever `NativeModules` or `lynx` is present — web-core's worker injects both — so a bare `fetch(...)` in the worker resolves to the native-backed one too, not the browser's. (`@sigx/lynx-plugin`'s bare-`fetch` ProvidePlugin rewrite is deliberately Lynx-only for the mirror-image reason: on the Lynx bundle a bare `fetch` binds to the engine's factory parameter.) On web, route requests through a `.web.ts` sibling or a `__WEB__` branch and don't rely on `fetch` from `@sigx/lynx` or on a bare `fetch(...)` — see the `@sigx/lynx-http` README's **Web** section.

## License

MIT — © Andreas Ekdahl
