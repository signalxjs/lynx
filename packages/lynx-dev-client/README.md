# @sigx/lynx-dev-client

Dev-only client for sigx-lynx apps: resource fetchers, template provider, devtool integration, on-device overlays (loading, error, perf HUD, connection banner), QR scanner, and the dev menu — all at parity across iOS and Android. Ships as a debug-only auto-linked module — release builds drop it entirely.

Install it as a `devDependency`; `@sigx/lynx-cli`'s autolinker picks it up from `node_modules` automatically — like every other `@sigx/lynx-*` module.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/dev-client/overview/](https://sigx.dev/lynx/modules/dev-client/overview/)**

## Install

```bash
pnpm add -D @sigx/lynx-dev-client
```

The lynx project templates already include this; manual install is only needed for projects that pre-date the template change.

## What it does

- **Resource fetchers** — `DevGenericResourceFetcher` / `DevTemplateResourceFetcher` (iOS and Android) load Lynx templates from the dev server over HTTP so HMR works. A **404 for a `*.css.hot-update.json`** is treated as "no CSS change for this chunk" (returns an empty `{}`) — the CSS-HMR runtime probes every chunk each update, and JS-only chunks have no CSS file, so this avoids a spurious `Failed to load CSS update file` on every save while leaving real CSS hot-reload untouched.
- **Template provider** — `DevTemplateProvider`, consumed by your `App.swift` / `MainActivity.kt` under `#if DEBUG`, points the LynxEnv at the dev server URL.
- **Dev overlays** — a loading spinner while a bundle (re)loads, a red error overlay (with Reload / Dismiss) on a load failure, a perf HUD, and a "disconnected from dev server" banner. Driven by a `DevLifecycleClient` (iOS) / the Compose `DevLynxScreen` state (Android), so both platforms show the same feedback.
- **Perf HUD** — a corner overlay showing **`Lynx mem` and `Nodes`**: the Lynx engine's own memory attribution, from `LynxMemoryUsageQuery`, polled every 5 s and only while the HUD is visible (the engine offers no push channel for memory). Requires Lynx ≥ 4.0.1.

  The HUD is also wired to Lynx 4.0's typed performance observer for eight timing metrics — `FCP`, `FMP`, `Bundle`, `JS core`, `Pipeline`, `MTS`, `Layout`, `UI flush` — declared identically on both platforms in `android/…/PerfMetrics.kt` and `ios/…/PerfMetrics.swift`, with a test that fails the build if the two lists drift. **Those eight render nothing at present**: the observer never fires in a sigx-lynx app, on either platform, and neither did the legacy sources it replaced. That is a Lynx-side problem (signalxjs/lynx#982, asked upstream as lynx-family/lynx#8405), not a configuration mistake on your side — they will start appearing when it is resolved. Metrics that haven't arrived are omitted rather than shown as `0.0ms`.
- **Dev menu** — reload, change/copy dev-server URL, and toggles for the perf HUD, logbox, and element inspector. Triggered by the shake gesture (`ShakeDetector`) on iOS and the equivalent on Android.
- **Devtool wiring** — registers the Lynx devtool / logbox services so the Chrome inspector and on-device error overlays light up.
- **Uncaught-error visibility** — in dev, hooks the background-thread `lynx.onError` plus `globalThis` `error`/`unhandledrejection` and `console.error`s the message + stack, so uncaught errors show up in the `sigx dev` terminal (not just as the bare native overlay). The on-device **error overlay** shows the **reason first** with a collapsible **"Show stacktrace"**, **pages through multiple errors** (`‹ N/M ›` arrows), and has a **Copy** button. It's the **sole** error UI — the native Lynx LogBox is off by default (the dev-menu "LogBox" toggle re-enables it). Dev-server/HMR noise (`hot-update` / CSS-update failures) is filtered out, and Lynx JSON-blob errors are unwrapped to their message. Android captures Lynx runtime errors via a `LynxViewClient` (parity with iOS's `didRecieveError`, the SDK's historical spelling). Every error shown on the overlay is also **mirrored to the `sigx dev` terminal**: the native error sink is a *superset* of the JS `lynx.onError` hook (it also catches main-thread-script, template, render and native-module errors), so a `DevServerReporter` POSTs each one to the log server's `/__sigx/device-error` endpoint (dev port + 1) where it prints as a `📱 <platform> … ERR …` line — making red-screen exceptions copyable in the Logs tab. Duplicates of an error that also reached the terminal via the JS console path are dropped server-side. (Production error capture/reporting is the opt-in `@sigx/lynx-observability`.)
- **Console log streaming** — patches `console.log/info/warn/error/debug/trace` on the BG thread in dev mode and ships entries to the dev server over WebSocket (`ws://<host>:<devPort+1>/__sigx/logs`). A persistent socket fits a continuous log stream and keeps the dev client standalone — it doesn't assume the app polyfilled `fetch` on the BG runtime (which has no built-in `fetch`; `@sigx/lynx-http` can add one, but isn't a dependency here). The native `WebSocket` comes from `@sigx/lynx-websocket` — that's the transport this uses. `@sigx/lynx-plugin` injects the install entry automatically; `@sigx/lynx-cli` parses the wire format and prints each entry in the terminal alongside the rspeedy output. Pass `--no-device-logs` to `sigx dev` to opt out. The same WebSocket's up/down state drives the on-device connection banner (via `DevClient.setConnectionState`).

## How it ends up in the app

`sigx prebuild` calls into `@sigx/lynx-cli`'s `copyDevClientSources{Ios,Android}`, which copies the Swift/Kotlin sources from this package into your native project and registers them. The generated `App.swift` template references `SigxDevClient.registerServices()` / `enableDevMode()` / `DevTemplateProvider()` under `#if DEBUG`.

## Permissions

The QR scanner requires camera access. The package's `signalx-module.json` declares this — autolinker adds `NSCameraUsageDescription` to `Info.plist` and `android.permission.CAMERA` to `AndroidManifest.xml`. Strip these from release builds by depending on this package only under `devDependencies`.

## Versioning

The version is exported as `DEV_CLIENT_VERSION` so `@sigx/lynx-cli` can warn if the dev client drifts from the CLI version it was bundled with.

## Web

Not used on web — and nothing is missing there. The overlays, dev menu, devtool wiring and QR scanner are iOS/Android sources that `sigx prebuild` copies into the native project, and `@sigx/lynx-plugin` prepends the console streamer to the background entry only for native dev builds (the prepend is gated on `isDev && !isWeb`), so a `sigx run:web` bundle contains none of this package. The browser supplies the equivalents directly: DevTools for the console, errors, network and element inspection, and `sigx run:web` runs its own watch loop — `rspeedy build --watch` rebuilds and a WebSocket tells the page to `location.reload()` (full reload, not hot-swap).

## Gotchas

- **This package doesn't use `createLogger`, and that's deliberate.** Every other `@sigx/lynx-*` package routes diagnostics through `createLogger` (CONVENTIONS.md C10), whose default transport writes to `console.*` — which is exactly what this package patches. The dev client sits *below* the logger: it's where log records end up, not a consumer of them. So its own transport diagnostics (`[sigx-dev-client] log stream WS closed, reconnecting: …`) go to the **captured console originals**, printing on-device only. Routing them through the patched console would queue every "the socket is down" warning for delivery over the socket that is down. There's a regression test (`does not stream its own transport-failure warning back to the server`) that fails if anyone changes this.

  The one place the patched console is used on purpose is uncaught-error visibility: `installDevErrorLogging` `console.error`s the app's own errors *so that* they get streamed to the terminal.

  Practical consequence: when the log stream is broken, nothing from any package reaches the `sigx dev` terminal, and the reason is only visible in the platform log (`adb logcat` / Xcode console).

- **No `@sigx/lynx-core` dependency.** `install.ts` is prepended to the very front of the background-thread entry, ahead of the app's own imports, so the dev client keeps a single runtime dependency (`@sigx/lynx-websocket`, for the transport). Its native module is therefore called directly — `NativeModules.DevClient.getPlatform / reload / setConnectionState`, all three implemented on both platforms — rather than through core's `callAsync`. `signalx-module.json` omits `ios.methods` for that reason: the C12 manifest gate resolves method names from `callAsync` / `callSync` call sites, so declaring names it cannot see would report all three as declared-but-never-called.

## License

MIT
