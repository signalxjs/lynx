# @sigx/lynx-dev-client

Dev-only client for sigx-lynx apps: resource fetchers, template provider, devtool integration, error overlay, perf HUD, QR scanner, and the on-device dev menu. Ships as a debug-only auto-linked module — release builds drop it entirely.

Install it as a `devDependency`; `@sigx/lynx-cli`'s autolinker picks it up from `node_modules` even when it's not listed under `modules` in `sigx.lynx.config.ts`.

## Install

```bash
pnpm add -D @sigx/lynx-dev-client
```

The lynx project templates already include this; manual install is only needed for projects that pre-date the template change.

## What it does

- **Resource fetchers** — `DevGenericResourceFetcher` / `DevTemplateResourceFetcher` (iOS and Android) load Lynx templates from the dev server over HTTP so HMR works.
- **Template provider** — `DevTemplateProvider`, consumed by your `App.swift` / `MainActivity.kt` under `#if DEBUG`, points the LynxEnv at the dev server URL.
- **Dev menu** — on-device QR scanner, settings sheet, and per-app dev shortcuts. Triggered by the shake gesture (`ShakeDetector`) on iOS and the equivalent on Android.
- **Devtool wiring** — registers the Lynx devtool / logbox services so the Chrome inspector and on-device error overlays light up.

## How it ends up in the app

`sigx prebuild` calls into `@sigx/lynx-cli`'s `copyDevClientSources{Ios,Android}`, which copies the Swift/Kotlin sources from this package into your native project and registers them. The generated `App.swift` template references `SigxDevClient.registerServices()` / `enableDevMode()` / `DevTemplateProvider()` under `#if DEBUG`.

## Permissions

The QR scanner requires camera access. The package's `sigx-module.json` declares this — autolinker adds `NSCameraUsageDescription` to `Info.plist` and `android.permission.CAMERA` to `AndroidManifest.xml`. Strip these from release builds by depending on this package only under `devDependencies`.

## Versioning

The version is exported as `DEV_CLIENT_VERSION` so `@sigx/lynx-cli` can warn if the dev client drifts from the CLI version it was bundled with.
