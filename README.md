# SignalX for Lynx

**The batteries-included way to ship native mobile apps with [SignalX](https://github.com/signalxjs/core).** Built on [Lynx](https://lynxjs.org/), it covers the whole stack — scaffold, build, run, and ship from one toolchain:

- **One CLI** — `sigx dev` / `sigx build` / `sigx run:ios` / `sigx run:android` / `sigx prebuild` / `sigx doctor`. Scaffold with `npm create @sigx@latest` and be on a device in minutes.
- **Autolinked native modules** — `pnpm add @sigx/lynx-haptics`, run `sigx prebuild`, done: the native code is linked and even the Android manifest permission is added for you. No pod wiring, no config. 25+ modules, from biometrics to WebSocket.
- **Headless-first UI** — behavior and structure ship as headless components on a design-system-neutral foundation ([`lynx-zero`](./packages/lynx-zero)); skin them with the DaisyUI-flavored design system (or the HeroUI-flavored pilot), or bring your own. Plus type-safe navigation, icon sets tree-shaken at build time to the glyphs you actually use, and streaming markdown with a true WYSIWYG editor.
- **A renderer built for 60fps** — dual-thread architecture: gestures and animations run frame-locked on the UI thread via `SharedValue`, even when JS is busy.
- **Lockstep versioning** — 40+ packages, one version. Any combination at the same range just works together.

The core is one import — `@sigx/lynx` re-exports `@sigx/reactivity`, `@sigx/runtime-core`, and the Lynx dual-thread renderer under a single import path. Everything else is opt-in: install the `@sigx/lynx-*` packages you need, and only what you add ships in your app.

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
| [`@sigx/lynx-datetime-picker`](./packages/lynx-datetime-picker) | Native date/time/datetime picker — `UIDatePicker` in a presented sheet on iOS, `DatePickerDialog` / `TimePickerDialog` on Android. |
| [`@sigx/lynx-device-info`](./packages/lynx-device-info) | Device model, OS version, locale, screen metrics. |
| [`@sigx/lynx-file-picker`](./packages/lynx-file-picker) | Generic file picker — `UIDocumentPickerViewController` on iOS, Storage Access Framework on Android. Picks *any* file (Files app / document browser UX); for the photo-library grid use `@sigx/lynx-image-picker`. |
| [`@sigx/lynx-file-system`](./packages/lynx-file-system) | Sandboxed file read/write/delete + file info in the app's documents/cache directories, plus binary reads (`readFileBase64` / `readFileAsArrayBuffer`) of any `file://` (and, on Android, `content://`) URI a picker hands back. |
| [`@sigx/lynx-haptics`](./packages/lynx-haptics) | Impact / selection / notification haptic feedback. |
| [`@sigx/lynx-image-picker`](./packages/lynx-image-picker) | Pick or capture images from the photo library / camera (PHPicker / Android Photo Picker). For arbitrary documents use `@sigx/lynx-file-picker`. |
| [`@sigx/lynx-linking`](./packages/lynx-linking) | Deep-link & URL scheme handling — `openURL`, `getInitialURL`, inbound URL events. |
| [`@sigx/lynx-location`](./packages/lynx-location) | GPS coordinates, one-shot + watch APIs. |
| [`@sigx/lynx-maps`](./packages/lynx-maps) | Native map view — `MKMapView` (Apple Maps) on iOS, `com.google.android.gms.maps.MapView` (Google Maps, API key required) on Android. |
| [`@sigx/lynx-network`](./packages/lynx-network) | Connectivity status (`wifi` / `cellular` / `none`). Not a transport — pair with `fetch` / `WebSocket`. |
| [`@sigx/lynx-notifications`](./packages/lynx-notifications) | Local push notifications & schedule. |
| [`@sigx/lynx-permissions`](./packages/lynx-permissions) | Shared Android permission helper — a dependency of the permission-using modules, linked automatically. You typically don't need to install it directly. |
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
| [`@sigx/lynx-zero`](./packages/lynx-zero) | Design-system-neutral UI foundation — the shared props/token contract (`SizeScale`, `ColorVariant`, …), theme engine, layout primitives (`Row` / `Col` / `Center` / `Spacer` / `ScrollView`), style utilities, and a shared Tailwind preset. Design systems (`lynx-daisyui`, `lynx-heroui`) build on it; apps import via their chosen design system. |
| [`@sigx/lynx-daisyui`](./packages/lynx-daisyui) | DaisyUI-flavored design system on the `@sigx/lynx-zero` foundation — components, stylesheet, themes, and Tailwind preset. Also ships `markdownComponents` / `useMarkdownEditorTheme()` for `@sigx/lynx-markdown` and a themed skin (`emojiClasses`, `EmojiPickerSheet`) for `@sigx/lynx-emoji`. |
| [`@sigx/lynx-heroui`](./packages/lynx-heroui) | HeroUI-flavored design system on the `@sigx/lynx-zero` foundation. **Pilot scope** while the shared contract is validated — `hero-light` / `hero-dark` themes and a representative component set. |
| [`@sigx/lynx-emoji`](./packages/lynx-emoji) | Themable emoji picker — headless `EmojiPicker` (search, category tabs, recycled grid, skin-tone variants, recents) or compose the parts yourself. Pure JS, emoji data generated from emojibase; optional `@sigx/lynx-markdown` editor plugin. |
| [`@sigx/lynx-keyboard`](./packages/lynx-keyboard) | Soft-keyboard handling — `KeyboardAvoidingView`, `KeyboardStickyView` / `InputAccessoryView`, `useKeyboard`. Pure JS over the `@sigx/lynx-safe-area` bridge (no extra native module). |
| [`@sigx/lynx-markdown`](./packages/lynx-markdown) | SignalX-native, streaming-aware markdown renderer **and editor** — `<MarkdownView>` parses markdown in JS (zero deps) and renders to native `<view>`/`<text>` with a render-function override API, plus `createMarkdownStream()` for flicker-free AI output; `<MarkdownEditor>` (from the `@sigx/lynx-markdown/editor` subpath) is true-WYSIWYG editing (markdown in/out) on `@sigx/lynx-richtext`. |
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

- **HTTP** — Lynx ships a built-in [`fetch()`](https://lynxjs.org/api/lynx-api/global/fetch.html) global on the BTS runtime, no import or wrapper needed:
  ```ts
  const res = await fetch('https://api.example.com/users');
  const users = await res.json();
  ```
  Caveats vs the browser: no CORS, no `redirect`, no `keepalive`, no `FormData` / `Blob`. Standard `Request` / `Response` / `json()` / `text()` otherwise.
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
