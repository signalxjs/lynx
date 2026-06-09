# @sigx/lynx-dev-client

Dev-only client for sigx-lynx apps: resource fetchers, template provider, devtool integration, on-device overlays (loading, error, perf HUD, connection banner), QR scanner, and the dev menu — all at parity across iOS and Android. Ships as a debug-only auto-linked module — release builds drop it entirely.

Install it as a `devDependency`; `@sigx/lynx-cli`'s autolinker picks it up from `node_modules` automatically — like every other `@sigx/lynx-*` module.

## Install

```bash
pnpm add -D @sigx/lynx-dev-client
```

The lynx project templates already include this; manual install is only needed for projects that pre-date the template change.

## What it does

- **Resource fetchers** — `DevGenericResourceFetcher` / `DevTemplateResourceFetcher` (iOS and Android) load Lynx templates from the dev server over HTTP so HMR works.
- **Template provider** — `DevTemplateProvider`, consumed by your `App.swift` / `MainActivity.kt` under `#if DEBUG`, points the LynxEnv at the dev server URL.
- **Dev overlays** — a loading spinner while a bundle (re)loads, a red error overlay (with Reload / Dismiss) on a load failure, a perf HUD, and a "disconnected from dev server" banner. Driven by a `DevLifecycleClient` (iOS) / the Compose `DevLynxScreen` state (Android), so both platforms show the same feedback.
- **Dev menu** — reload, change/copy dev-server URL, and toggles for the perf HUD, logbox, and element inspector. Triggered by the shake gesture (`ShakeDetector`) on iOS and the equivalent on Android.
- **Devtool wiring** — registers the Lynx devtool / logbox services so the Chrome inspector and on-device error overlays light up.
- **Console log streaming** — patches `console.log/info/warn/error/debug/trace` on the BG thread in dev mode and ships entries to the dev server over WebSocket (`ws://<host>:<devPort+1>/__sigx/logs`). The Lynx BG runtime has no `fetch` / `XMLHttpRequest`, but ships a native `WebSocket` via `@sigx/lynx-websocket` — that's the transport this uses. `@sigx/lynx-plugin` injects the install entry automatically; `@sigx/lynx-cli` parses the wire format and prints each entry in the terminal alongside the rspeedy output. Pass `--no-device-logs` to `sigx dev` to opt out. The same WebSocket's up/down state drives the on-device connection banner (via `DevClient.setConnectionState`).

## How it ends up in the app

`sigx prebuild` calls into `@sigx/lynx-cli`'s `copyDevClientSources{Ios,Android}`, which copies the Swift/Kotlin sources from this package into your native project and registers them. The generated `App.swift` template references `SigxDevClient.registerServices()` / `enableDevMode()` / `DevTemplateProvider()` under `#if DEBUG`.

## Permissions

The QR scanner requires camera access. The package's `signalx-module.json` declares this — autolinker adds `NSCameraUsageDescription` to `Info.plist` and `android.permission.CAMERA` to `AndroidManifest.xml`. Strip these from release builds by depending on this package only under `devDependencies`.

## Versioning

The version is exported as `DEV_CLIENT_VERSION` so `@sigx/lynx-cli` can warn if the dev client drifts from the CLI version it was bundled with.
