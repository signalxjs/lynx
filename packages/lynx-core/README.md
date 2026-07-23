# @sigx/lynx-core

> **Low-level internals.** Most app code should import from [`@sigx/lynx`](https://sigx.dev/lynx/) or the specific module package (`@sigx/lynx-camera`, `@sigx/lynx-haptics`, …). This package's API is intended for authors of new native modules.

Low-level native-module bridge for sigx-lynx. Every `@sigx/lynx-*` native module package (`-camera`, `-haptics`, `-storage`, `-network`, …) depends on this for its iOS/Android plumbing.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/core/overview/](https://sigx.dev/lynx/modules/core/overview/)**

## API

```ts
import {
    getModule,
    callSync,
    callAsync,
    isModuleAvailable,
    guardModule,
} from '@sigx/lynx-core';
```

- **`getModule(name)`** — return the `NativeModules[name]` proxy that the Lynx runtime injects, or `undefined` if the module isn't linked.
- **`callSync(name, method, ...args)`** — invoke a bridge method that returns synchronously.
- **`callAsync(name, method, ...args)`** — invoke a bridge method that returns a `Promise`.
- **`isModuleAvailable(name)`** — feature-detect a module without throwing.
- **`guardModule(name)`** — throw a descriptive error if the module isn't linked (use at module-package entry points).

## Logging

A tiny leveled + namespaced logger lives here so any package can log without taking a new dependency.
**App code should import it from the umbrella** — `import { createLogger } from '@sigx/lynx'` (which
re-exports the logging API); the `@sigx/lynx-core` import below is for module authors / packages that
already depend on core.

```ts
import { createLogger, setLogLevel, disableNamespace } from '@sigx/lynx-core'; // app code: from '@sigx/lynx'

const log = createLogger('checkout');
log.debug('cart opened', { items: 3 });
log.warn('coupon expired', code);
log.error('charge failed', err);
```

- **Levels**: `trace` < `debug` < `info` < `warn` < `error` (plus `silent`). Records at or above the
  current threshold are emitted; below are dropped.
- **Default level**: `debug` in development, `warn` in release builds — so verbose traces are dev-only
  with zero config. Override at runtime with `setLogLevel('info' | 'warn' | 'silent' | …)`.
- **Namespaces**: `createLogger(ns)` tags every record; silence one with `disableNamespace(ns)` /
  restore with `enableNamespace(ns)`. `log.enabled(level)` lets you guard expensive log construction on hot paths.
- **Transports**: records flow to pluggable sinks. The default `consoleTransport` routes by level to
  `console.*`, which `@sigx/lynx-dev-client` streams to the `sigx dev` terminal in development (no extra
  wiring). Add your own with `addTransport(record => …)`; `clearTransports()` replaces the default.
  Production error capture and remote provider sinks will live in the opt-in `@sigx/lynx-observability`
  package, which registers transports here.

```ts
import { addTransport, type LogRecord } from '@sigx/lynx-core';
addTransport((r: LogRecord) => myBackend.send(r)); // { level, namespace, msg, fields, ts }
```

## Platform checks & rendering

`Platform` gives RN-style platform checks, sourced from the Lynx `SystemInfo`
global. **App code should import it from the umbrella** — `import { Platform } from '@sigx/lynx'`.

```ts
import { Platform } from '@sigx/lynx'; // module authors: from '@sigx/lynx-core'

Platform.OS;          // 'ios' | 'android' | 'web'
Platform.Version;     // OS version string, e.g. '17.4'
Platform.pixelRatio;  // device pixel ratio (also pixelWidth / pixelHeight)
Platform.isPad;       // best-effort iPad detection

const gap = Platform.select({ ios: 8, android: 12, web: 16, default: 0 });
```

`Platform.select(spec)` precedence is exact OS key → `native` (ios/android) →
`default`. Provide `default` and the return type is `T`; omit it and it's `T | undefined`.

**Two tiers.** `Platform.OS` is a *runtime* convenience — both platform branches
ship in every bundle, like React Native. For *tree-shakeable* platform code,
branch on the build-time defines `@sigx/lynx-plugin` injects, or use
platform file extensions:

```ts
// __WEB__ / __NATIVE__ fold to literals per rspeedy environment, so the dead
// branch is dropped from the other bundle. (Types via `@sigx/lynx/client`.)
if (__WEB__) { /* web-only code, absent from the native bundle */ }

// __MAIN_THREAD__ / __BACKGROUND__ fold to literals per bundle LAYER (Lepus
// main thread vs background JS). Inside a 'main thread' worklet body the
// registered MT form keeps only its __MAIN_THREAD__ branch; everywhere else
// only __BACKGROUND__ branches survive. App/workspace-src code only —
// published dists must use a runtime check instead.
if (__BACKGROUND__) { /* absent from the main-thread bundle */ }
```

- **File extensions**: `Foo.web.tsx` resolves on the web bundle, `Foo.lynx.tsx`
  / `Foo.native.tsx` on the native bundle, each ahead of `Foo.tsx`. **Only
  web↔native swaps** — iOS and Android share one native bundle, so use
  `Platform.OS` / `Platform.select` at runtime to split those.

## Device info

`DeviceInfo` is an async, native-backed snapshot (manufacturer, model, brand,
OS/app version, screen metrics) — complementing the synchronous `Platform`
surface. Served by core's own `SigxCore` native module.

`getInfo()` resolves a **platform-discriminated** `DeviceInfoResult`: a common
core present on every platform, plus a `platform` discriminant that narrows to
per-platform extras. Switch on `info.platform` to read them type-safely.

```ts
import { DeviceInfo } from '@sigx/lynx'; // module authors: from '@sigx/lynx-core'

if (DeviceInfo.isAvailable()) {
    const info = await DeviceInfo.getInfo();
    console.log(info.model, info.systemVersion);

    if (info.platform === 'ios') {
        console.log(info.bundleId, info.modelName); // iOS-only extras
    } else {
        console.log(info.appPackage, info.sdkVersion); // Android-only extras
    }
}
```

**Common fields** (both platforms, identical semantics): `platform`,
`manufacturer`, `model`, `brand`, `systemName`, `systemVersion`, `appVersion`,
`deviceId`, `screenWidth`, `screenHeight`, `screenScale`. Screen dimensions are
**density-independent points (dp/pt)** on both platforms and `screenScale` is the
dp→physical-px multiplier — physical pixels ≈ `Math.round(screenWidth * screenScale)`
(approximate: dp is reported as an integer, so exact pixel recovery isn't guaranteed).
**iOS extras**: `modelName` (hardware id, e.g. `"iPhone16,2"`), `appBuildNumber`,
`bundleId`. **Android extras**: `sdkVersion`, `appPackage`.

> Field caveats: `model` is a friendly name on Android (`Build.MODEL`) but the
> generic `"iPhone"`/`"iPad"` on iOS (the hardware id is the iOS-only `modelName`).
> `deviceId` is a per-vendor stable UUID on iOS (`identifierForVendor`) but
> `Build.ID` — a build identifier, not a stable device id — on Android.

## Permissions helpers

For modules that need runtime permissions (camera, location, notifications, …) the package re-exports the shared `PermissionStatus` / `PermissionResponse` types used by `@sigx/lynx-permissions`.

## Shared native helpers

Besides the JS bridge, the package ships a small shared native runtime that the autolinker copies into the generated project whenever any native module is installed (the package is discovered transitively — modules depend on `@sigx/lynx-core`, so apps never declare it for this):

- **Android — `com.sigx.core.SigxActivityHolder`**: weak reference to the current foreground Activity, fed by the auto-linked `SigxActivityHook` lifecycle hook. Modules that present platform UI (`BiometricPrompt`, `DatePickerDialog`, permission dialogs, …) read `current()` or `currentFragmentActivity()` at call time instead of each shipping their own holder.
- **iOS — `SigxPresentation.topPresenter()`**: top-most `UIViewController` on the active scene's key window (multi-scene safe, walks the presented-modal chain). Used by the picker modules to present sheets.

- **`FontScalePublisher`** (both platforms): follows the OS text-size setting (iOS Dynamic Type via `UIFontMetrics`, Android `Configuration.fontScale`), clamped by the app's `fontScale` policy from `signalx.config.ts`. Seeds `lynx.__globalProps.fontScale = { scale, os }` before first paint and pushes runtime changes into the engine via `LynxView.updateFontScale()` — the engine relayouts text in place and emits `onFontScaleChanged` to JS.

  The JS reads live here too (re-exported by `@sigx/lynx` and `@sigx/lynx-appearance`): **`useFontScale()`** — reactive `Computed<number>` of the effective scale (`1` = default; no provider needed); **`useFontScaleMT()`** — sync read for `'main thread'` worklet bodies; **`readGlobalFontScale()`** — sync `{ scale, os }` or `null` when unwired. The engine scales ordinary text automatically — use these to adapt *around* larger text (layout swaps, custom-drawn text like `@sigx/lynx-markdown`'s editor, icon sizing).

The package also registers core's own native module, **`SigxCore`**, which backs `DeviceInfo` (`getDeviceInfo` / `getConstants`).

Module authors: don't add a per-package Activity holder or top-presenter helper — use these.

## Linking

Native modules are wired by `@sigx/lynx-cli`'s autolinker. Install the package (`pnpm add @sigx/lynx-foo`), run `sigx prebuild`, and the generated registry takes care of the rest — the `signalx-module.json` manifest each module ships is what makes auto-discovery work.
