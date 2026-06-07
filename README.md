# SignalX for Lynx

[Lynx](https://lynxjs.org/) bindings, runtime, build plugin, CLI plugin, native modules, and UI kit for [SignalX](https://github.com/signalxjs/core) — a single import path (`@sigx/lynx`) on top of `@sigx/reactivity` + `@sigx/runtime-core`, with the Lynx-specific dual-thread renderer underneath.

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
pnpm run:android   # or run:ios
```

## Prerequisites

- Node 22+, pnpm 10+
- For iOS: macOS, Xcode 15+, CocoaPods
- For Android: Android Studio + SDK Platform 34+

## Packages

All `@sigx/lynx-*` packages ship in **lockstep** — they share one version (the "Lynx framework version"). Install any combination at the same `X.Y.*` range and they're guaranteed to work together. See [`RELEASING.md`](RELEASING.md) for the policy.

### Framework

The packages most apps depend on directly.

| Package | Description |
|---|---|
| [`@sigx/lynx`](./packages/lynx) | Public framework barrel — re-exports `@sigx/reactivity`, `@sigx/runtime-core`, and `@sigx/lynx-runtime` under one import. Documents `SharedValue` / `useSharedValue`, the cross-thread primitive that powers gestures, scroll, and animation. |
| [`@sigx/lynx-plugin`](./packages/lynx-plugin) | Rspack/Rspeedy plugin: splits your source into the BG + MT bundles Lynx requires and runs the SWC `'main thread'` worklet transform. |
| [`@sigx/lynx-cli`](./packages/lynx-cli) | `@sigx/cli` plugin — `dev` / `build` / `prebuild` / `doctor` / `run:android` / `run:ios`, plus the autolinker for `@sigx/lynx-*` native modules. |

### Runtime

The dual-thread renderer. Application code rarely imports these directly — `@sigx/lynx` re-exports their public surface and `@sigx/lynx-plugin` wires the bootstrap.

| Package | Description |
|---|---|
| [`@sigx/lynx-runtime`](./packages/lynx-runtime) | Background-thread renderer: sigx `RuntimeRenderer` adapter, op queue, `useMainThreadRef`, `useSharedValue`, `runOnMainThread`. |
| [`@sigx/lynx-runtime-main`](./packages/lynx-runtime-main) | Main-thread (Lepus) runtime: applies the BG → MT op stream via Lynx PAPI, runs `'main thread'` worklets, drives `useAnimatedStyle`. |
| [`@sigx/lynx-runtime-internal`](./packages/lynx-runtime-internal) | Shared op-code + mapper types so the BG and MT runtimes stay in lockstep. Not a user-facing package. |
| [`@sigx/lynx-core`](./packages/lynx-core) | Low-level `NativeModules` bridge (`getModule`, `callSync`, `callAsync`, `guardModule`). Every native-module package depends on this. |

### Native modules

Auto-linked by `sigx prebuild`: install the package with `pnpm add @sigx/lynx-foo` and the next `sigx prebuild` picks it up — no config edit needed. To opt out, list the package in `excludeModules: [...]` in your `signalx.config.ts`, or pass `{ package: '@sigx/lynx-foo', disabled: true }` in `modules:`.

| Package | Description |
|---|---|
| [`@sigx/lynx-appearance`](./packages/lynx-appearance) | System appearance — observe the device color scheme (`light` / `dark`) and set status / navigation bar tint. |
| [`@sigx/lynx-audio`](./packages/lynx-audio) | Audio recording and playback — `AVAudioPlayer` / `AVAudioRecorder` on iOS, `MediaPlayer` / `MediaRecorder` on Android. |
| [`@sigx/lynx-background`](./packages/lynx-background) | Periodic background tasks — iOS `BGTaskScheduler` (`BGAppRefreshTask` / `BGProcessingTask`) and Android `WorkManager` (`PeriodicWorkRequest` / `OneTimeWorkRequest`). |
| [`@sigx/lynx-biometric`](./packages/lynx-biometric) | Biometric authentication — Face ID / Touch ID / `BiometricPrompt`. |
| [`@sigx/lynx-camera`](./packages/lynx-camera) | Camera capture (photo + video). |
| [`@sigx/lynx-clipboard`](./packages/lynx-clipboard) | System clipboard read/write. |
| [`@sigx/lynx-device-info`](./packages/lynx-device-info) | Device model, OS version, locale, screen metrics. |
| [`@sigx/lynx-file-picker`](./packages/lynx-file-picker) | Generic file picker — any file type via `UIDocumentPickerViewController` / SAF `OpenDocument`. Assets resolve `{ uri, name, mimeType, size }`, ready for `FormData` uploads. |
| [`@sigx/lynx-file-system`](./packages/lynx-file-system) | Sandboxed read/write/delete + directory listing in the app's documents directory. Binary reads via `readFileBase64` / `readFileAsArrayBuffer` (accepts `file://` and `content://` URIs). |
| [`@sigx/lynx-haptics`](./packages/lynx-haptics) | Impact / selection / notification haptic feedback. |
| [`@sigx/lynx-http`](./packages/lynx-http) | WHATWG `fetch` global — URLSession / OkHttp transport with `FormData` multipart uploads (file bytes stream natively from URIs) and upload progress. Default-wired through `@sigx/lynx`. |
| [`@sigx/lynx-image-picker`](./packages/lynx-image-picker) | Pick or capture images from the photo library / camera. |
| [`@sigx/lynx-linking`](./packages/lynx-linking) | Deep-link & URL scheme handling — `openURL`, `getInitialURL`, inbound URL events. |
| [`@sigx/lynx-location`](./packages/lynx-location) | GPS coordinates, one-shot + watch APIs. |
| [`@sigx/lynx-maps`](./packages/lynx-maps) | Native map view — `MKMapView` (Apple Maps) on iOS, `com.google.android.gms.maps.MapView` (Google Maps, API key required) on Android. |
| [`@sigx/lynx-network`](./packages/lynx-network) | Connectivity status (`wifi` / `cellular` / `none`). Not a transport — pair with `fetch` / `WebSocket`. |
| [`@sigx/lynx-notifications`](./packages/lynx-notifications) | Local push notifications & schedule. |
| [`@sigx/lynx-permissions`](./packages/lynx-permissions) | Shared Android permission helper used by other native modules. You normally don't depend on this directly. |
| [`@sigx/lynx-richtext`](./packages/lynx-richtext) | Native attributed-text input `<sigx-richtext>` — `UITextView` / `EditText` with in-field rich formatting (bold is bold *inside* the input), a flat span/block document model over the bridge, and an IME-safe echo contract. Format-agnostic: powers `@sigx/lynx-markdown`'s `MarkdownEditor`, but serialization is the consumer's choice. |
| [`@sigx/lynx-safe-area`](./packages/lynx-safe-area) | Safe-area insets (notch, home indicator, status bar, keyboard). |
| [`@sigx/lynx-secure-storage`](./packages/lynx-secure-storage) | Encrypted KV storage — iOS Keychain, Android Keystore + `EncryptedSharedPreferences`. Optional per-key biometric gating. |
| [`@sigx/lynx-share`](./packages/lynx-share) | Native share sheet (`UIActivityViewController` / `Intent.ACTION_SEND`). |
| [`@sigx/lynx-storage`](./packages/lynx-storage) | Persistent string KV store (`UserDefaults` / `SharedPreferences`). |
| [`@sigx/lynx-video`](./packages/lynx-video) | Native `<video-player>` component — `AVPlayer` + `AVPlayerLayer` on iOS, `androidx.media3` (`ExoPlayer` + `PlayerView`) on Android. |
| [`@sigx/lynx-websocket`](./packages/lynx-websocket) | Browser-standard `WebSocket` global — `URLSessionWebSocketTask` on iOS, OkHttp on Android. |
| [`@sigx/lynx-webview`](./packages/lynx-webview) | Native `<sigx-webview>` component — `WKWebView` on iOS, `android.webkit.WebView` on Android. For OAuth fallback flows, embedded help/TOS, and hybrid screens. |

### Dev tooling

| Package | Description |
|---|---|
| [`@sigx/lynx-dev-client`](./packages/lynx-dev-client) | Debug-only auto-linked module — resource fetchers, template provider, on-device dev menu, QR scanner, devtool wiring. Install as a `devDependency` so release builds drop it entirely. |
| [`@sigx/lynx-testing`](./packages/lynx-testing) | Component testing utilities: `render`, `fireEvent`, queries — no native runtime needed. |

### UI & routing

| Package | Description |
|---|---|
| [`@sigx/lynx-daisyui`](./packages/lynx-daisyui) | DaisyUI-flavored component library, stylesheet, and Tailwind preset for Lynx. Also ships `markdownComponents` (themed rendering) and `useMarkdownEditorTheme()` (palette-driven editor colors) for `@sigx/lynx-markdown`. |
| [`@sigx/lynx-markdown`](./packages/lynx-markdown) | SignalX-native, streaming-aware markdown renderer **and editor** — `<MarkdownView>` parses markdown in JS (zero deps) and renders to native `<view>`/`<text>` with a render-function override API, plus `createMarkdownStream()` for flicker-free AI output; `<MarkdownEditor>` is true-WYSIWYG editing (markdown in/out) on `@sigx/lynx-richtext`. |
| [`@sigx/lynx-icons`](./packages/lynx-icons) | `<Icon set name />` component + registry. Pairs with adapter packages (`@sigx/lynx-icons-fa-free`, `@sigx/lynx-icons-lucide`); used icons are auto-detected from JSX at build time and subset/tree-shaken. |
| [`@sigx/lynx-icons-fa-free`](./packages/lynx-icons-fa-free) | Font Awesome Free adapter for `@sigx/lynx-icons` (solid/regular/brands). Reads glyph data from the user's installed `@fortawesome/free-*-svg-icons` packages. |
| [`@sigx/lynx-icons-lucide`](./packages/lynx-icons-lucide) | Lucide adapter for `@sigx/lynx-icons`. SVG-mode only (lucide has no font distribution). |
| [`@sigx/lynx-navigation`](./packages/lynx-navigation) | Type-first native navigator — `Stack`, `Tabs`, `Drawer`, modals, lazy routes, deep links. |

### Gestures & motion

Frame-locked touch handling and animation drivers. Both plug into the cross-thread `SharedValue` bridge documented in [`@sigx/lynx`](./packages/lynx), so gestures and animations stay on the main UI thread even when the JS thread is busy.

| Package | Description |
|---|---|
| [`@sigx/lynx-gestures`](./packages/lynx-gestures) | `<Pressable>`, `<Draggable>`, `<Swipeable>`, plus `useTap` / `usePan` / `usePinch` / `useSwipe` / `useLongPress` / `useFling` / `useRotation` / `usePanResponder` and a `useGesture` composer. |
| [`@sigx/lynx-motion`](./packages/lynx-motion) | `withSpring`, `withTiming`, `animate` — animation progress is observable from the background thread for free (each MT frame ships to a BG-side sigx `signal`). |

## Networking

The same split the web platform uses:

- **HTTP** — [`@sigx/lynx-http`](./packages/lynx-http) provides a WHATWG `fetch` global (URLSession on iOS, OkHttp on Android), **default-wired through `@sigx/lynx`** so every app has it with no install step:
  ```ts
  const res = await fetch('https://api.example.com/users');
  const users = await res.json();
  ```
  Includes `FormData` multipart uploads — picked-file bytes stream natively from their URI, never through the JS bridge — plus upload progress and a `TextDecoder` shim. When the native module is linked it replaces any engine-built-in fetch (which lacks `FormData`/streaming); web/Node hosts keep theirs. Streaming response bodies (`res.body.getReader()` for SSE) land with [#250](https://github.com/signalxjs/lynx/issues/250).
- **WebSocket** — install [`@sigx/lynx-websocket`](./packages/lynx-websocket) and run `sigx prebuild`. Registers a browser-standard `WebSocket` global backed by `URLSessionWebSocketTask` (iOS) and OkHttp (Android).
- **Connectivity status** — [`@sigx/lynx-network`](./packages/lynx-network) reports online/offline + connection type. Not a transport; pair with `fetch` / `WebSocket`.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

To work against a sibling [`signalxjs/core`](https://github.com/signalxjs/core) checkout, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Releasing

See [RELEASING.md](./RELEASING.md). Publishing is automated via GitHub Actions using npm Trusted Publishing (OIDC) — no `NPM_TOKEN` is stored anywhere.

## License

MIT — © Andreas Ekdahl
