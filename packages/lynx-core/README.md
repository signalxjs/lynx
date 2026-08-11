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

- **`getModule(name)`** — return the `NativeModules[name]` proxy that the Lynx runtime injects. It **throws** if the module isn't linked (a `SigxError` with `code: 'module_unavailable'`, naming the package to install); it never returns `undefined`. Use `isModuleAvailable(name)` to feature-detect without throwing.
- **`callSync(name, method, ...args)`** — invoke a bridge method that returns synchronously.
- **`callAsync(name, method, ...args)`** — invoke a bridge method that returns a `Promise`.
- **`isModuleAvailable(name)`** — feature-detect a module without throwing.
- **`guardModule(name)`** — throw a descriptive error if the module isn't linked (use at module-package entry points).

### The module contract

Three helpers every `@sigx/lynx-*` package is expected to use rather than reimplement. They are the executable half of [`CONVENTIONS.md`](../../CONVENTIONS.md) C4, C7 and C10.

```ts
import { subscribeNative, unwrapNative, SigxError } from '@sigx/lynx-core';
```

- **`subscribeNative(channel, cb, options?)`** — subscribe to a native event channel; returns an unsubscribe function (never a `{ remove() }` object), and calling it twice is a no-op. Handles the four things every hand-rolled copy had to get right independently: fetching the emitter through `lynx.getJSModule`, payloads that arrive as a JSON *string* rather than an object, a listener that throws (contained and reported through the logger, not `console`), and off-device — where it is a silent no-op, so a package can subscribe unconditionally without branching on availability. Pass `options.validate` to drop payloads that don't match the expected shape, and `options.namespace` to tag the diagnostic with your package.

  ```ts
  const off = subscribeNative<PushEvent>('__sigxPush', onPush, {
      validate: (raw): raw is PushEvent => typeof (raw as PushEvent)?.id === 'string',
      namespace: 'lynx-notifications',
  });
  ```

- **`isNativeEventsAvailable()`** — whether the runtime's `GlobalEventEmitter` is reachable right now. Most packages don't need it: `subscribeNative` is a safe no-op off-device, so just subscribe. It's for the *lazy-latch* pattern — a module that wires on its first API call and must retry until the emitter appears, because that call can race runtime init. The disposer can't answer that question (the off-device no-op is indistinguishable from a real one), and re-deriving `lynx.getJSModule` to answer it is what this contract exists to prevent.

  ```ts
  if (!wired && isNativeEventsAvailable()) {
      subscribeNative(CHANNEL, onEvent, { namespace: 'lynx-http' });
      wired = true;   // latch only on success, so a racing first call retries
  }
  ```

- **`unwrapNative(pkg, action, raw)`** — `callAsync` only rejects when the *synchronous* call throws; native failures come back on the resolved callback as `{ error }`. This unwraps them once, throwing `[@sigx/lynx-<pkg>] <action> failed: <cause>`. `unwrapNativeVoid` is the same for methods with no success payload.

  ```ts
  const raw = await callAsync<{ uri?: string; error?: string }>('Camera', 'takePicture', opts);
  const { uri } = unwrapNative('lynx-camera', 'takePicture', raw);
  ```

- **`SigxError`** — base error carrying a stable `code` and the raising `package`, for anything a caller might branch on. Narrow with `isSigxError(e)`; branch on `e.code`, never on the message.

  Core itself raises two codes, and between them they cover the failures every module package inherits without writing any error of its own:

  | `code` | Raised by | Means |
  | --- | --- | --- |
  | `'module_unavailable'` | `getModule` / `callSync` / `callAsync` / `guardModule` | The native module isn't in this build. Not recoverable at runtime — feature-detect with `isAvailable()` instead of catching. |
  | `'native_error'` | `unwrapNative` / `unwrapNativeVoid` | The platform reported a failure; the raw native payload is on `cause`. |

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

## Screen metrics & orientation

`Platform.pixelWidth` / `pixelHeight` describe the **device** and are read once
at module load. For anything that feeds layout, use `useScreen()` — it follows
rotation, split-screen and foldable unfold, fed by core's native
`ScreenMetricsPublisher`.

```tsx
import { useScreen, useOrientation, useScreenMT } from '@sigx/lynx';

const screen = useScreen();          // Computed<ScreenMetrics>, BG-reactive
// screen.value → { width, height, scale, orientation, isLandscape }
//   width/height are logical (dp on Android, pt on iOS)
//   orientation is 'portrait' | 'portrait-upside-down'
//                | 'landscape-left' | 'landscape-right'

const orientation = useOrientation(); // Computed<'portrait' | 'landscape'>

const onTap = () => {
    'main thread';
    const { height } = useScreenMT();  // sync read, worklet-safe
};
```

`readGlobalScreen()` is the raw synchronous read (`ScreenMetrics | null`). It
works on **both** threads — `lynx.SystemInfo` is empty on the background thread,
`__globalProps` is not — which makes it the BG-safe screen-size accessor.

### Runtime orientation lock

```ts
import { Orientation, useOrientationLock } from '@sigx/lynx';

await Orientation.lock('landscape');   // 'portrait' | 'landscape' | 'landscape-left' | …
await Orientation.unlock();            // back to the configured set

useOrientationLock('landscape');       // locks on mount, restores on unmount
```

`'default'` means "no runtime lock" — `lock('default')` is an alias for
`unlock()` on every platform. `useOrientationLock` keeps a **stack** of holders,
because `@sigx/lynx-navigation` leaves a covered screen mounted under a card,
modal or sheet: popping the covering screen restores the covered one's lock
rather than falling through to the build-time default, and the runtime lock is
only released once the last holder unmounts.

**The build-time config is the ceiling.** `signalx.config.ts`'s `orientation`
(default `'portrait'`) is written into `android:screenOrientation` and iOS's
`UISupportedInterfaceOrientations`; the OS won't rotate outside it. Requesting
an orientation the app didn't declare **rejects** with a message naming the
config change — set `orientation: 'default'` or `'all'` and re-run
`sigx prebuild`. The rejection is a `SigxError` with `code: 'native_error'`, so
branch on the code rather than the message.

On iOS 15 a lock takes effect at the next physical rotation rather than snapping
immediately: forcing rotation needs `requestGeometryUpdate` (iOS 16+). Raise
`ios.deploymentTarget` to `'16.0'` for the immediate flip.

**Web.** `useScreen()` / `useOrientation()` / `readGlobalScreen()` work — the
`@sigx/lynx-web-host` page bridge publishes the same channels from `resize` and
`screen.orientation`. `Orientation.lock()` is *degraded*: the Screen Orientation
API only permits locking while the document is fullscreen and several browsers
(all of iOS, desktop Safari) don't implement it at all, so `lock()` rejects with
an explanatory message there. Feature-detect with `Orientation.isAvailable()`.

## Permissions helpers

For modules that need runtime permissions (camera, location, notifications, …) the package re-exports the shared `PermissionStatus` / `PermissionResponse` types used by `@sigx/lynx-permissions`.

## Shared native helpers

Besides the JS bridge, the package ships a small shared native runtime that the autolinker copies into the generated project whenever any native module is installed (the package is discovered transitively — modules depend on `@sigx/lynx-core`, so apps never declare it for this):

- **Android — `com.sigx.core.SigxActivityHolder`**: weak reference to the current foreground Activity, fed by the auto-linked `SigxActivityHook` lifecycle hook. Modules that present platform UI (`BiometricPrompt`, `DatePickerDialog`, permission dialogs, …) read `current()` or `currentFragmentActivity()` at call time instead of each shipping their own holder.
- **iOS — `SigxPresentation.topPresenter()`**: top-most `UIViewController` on the active scene's key window (multi-scene safe, walks the presented-modal chain). Used by the picker modules to present sheets.

- **`FontScalePublisher`** (both platforms): follows the OS text-size setting (iOS Dynamic Type via `UIFontMetrics`, Android `Configuration.fontScale`), clamped by the app's `fontScale` policy from `signalx.config.ts`. Seeds `lynx.__globalProps.fontScale = { scale, os }` before first paint and pushes runtime changes into the engine via `LynxView.updateFontScale()` — the engine relayouts text in place and emits `onFontScaleChanged` to JS.

  The JS reads live here too (re-exported by `@sigx/lynx` and `@sigx/lynx-appearance`): **`useFontScale()`** — reactive `Computed<number>` of the effective scale (`1` = default; no provider needed); **`useFontScaleMT()`** — sync read for `'main thread'` worklet bodies; **`readGlobalFontScale()`** — sync `{ scale, os }` or `null` when unwired. The engine scales ordinary text automatically — use these to adapt *around* larger text (layout swaps, custom-drawn text like `@sigx/lynx-markdown`'s editor, icon sizing).

- **`ScreenMetricsPublisher`** (both platforms): publishes the live viewport size + interface orientation to `lynx.__globalProps.screen` and the `screenChanged` global event — what `useScreen()` reads. It also keeps the engine in sync: `LynxView.updateScreenMetrics()` re-bases `rpx`, and on iOS it re-pins `preferredLayoutWidth/Height` and calls `updateViewport(…needLayout:)`, without which the exact-mode layout box would stay at its launch size forever. The managed Android manifest declares `configChanges="…|orientation|screenSize|…"` so a rotation is handled in place instead of recreating the Activity and reloading the bundle.

- **`SigxOrientation`** (both platforms): the runtime lock behind `Orientation.lock()`. Android sets `Activity.requestedOrientation` and restores the manifest-declared value on unlock; iOS holds the mask the host AppDelegate's `supportedInterfaceOrientationsFor` returns (its default is stamped from `signalx.config.ts` by `sigx prebuild`, because implementing that delegate method overrides `Info.plist`).

The package also registers core's own native module, **`SigxCore`**, which backs `DeviceInfo` (`getDeviceInfo`), `AppState` (`getAppState`) and the orientation lock (`lockOrientation` / `unlockOrientation`). Those four are the whole surface — every method the module implements is called from JS and declared in `signalx-module.json` (CONVENTIONS.md C12).

Module authors: don't add a per-package Activity holder or top-presenter helper — use these.

## Linking

Native modules are wired by `@sigx/lynx-cli`'s autolinker. Install the package (`pnpm add @sigx/lynx-foo`), run `sigx prebuild`, and the generated registry takes care of the rest — the `signalx-module.json` manifest each module ships is what makes auto-discovery work.

## Web

Mixed by surface, since core is half host-agnostic JS and half native bridge:

- **Unchanged on web.** `Platform` / `select()` (`Platform.OS === 'web'`), the logger and its transports, `SigxError` / `unwrapNative`, `base64ToArrayBuffer` / `arrayBufferToBase64`, and `subscribeNative` — upstream web-core does inject a `GlobalEventEmitter` into the worker, so native-event subscriptions genuinely deliver on web (that is how the appearance and screen channels below arrive). Its silent-no-op path is for hosts where no emitter is reachable at all (SSR, tests), which is why packages can subscribe unconditionally.
- **Served by the page bridge.** `useScreen()` / `useOrientation()` / `readGlobalScreen()` work — `@sigx/lynx-web-host` publishes the same `__globalProps.screen` + `screenChanged` channels from `resize` and `screen.orientation`. `webHostCall()` / `isWebHostAvailable()` are the worker→page RPC used by the `.web.ts` shims that need an API only the page has: clipboard, linking, share, file picker, image picker, haptics, location, notifications. Shims for APIs the worker already owns don't go through it — storage uses IndexedDB, network reads `navigator.onLine`, websocket uses the worker's own `WebSocket`, and observability's memory read is local.
- **Degraded.** `Orientation.lock()` resolves to `orientation.web.ts`, backed by the Screen Orientation API: locking only works on a fullscreen document and several browsers (all of iOS, desktop Safari) don't implement it at all, so it rejects with an explanatory message there. Feature-detect with `Orientation.isAvailable()`.
- **Unsupported.** The `SigxCore` native module isn't registered on web, so `DeviceInfo` and `AppState` have no source — `DeviceInfo.isAvailable()` / `AppState.available` are `false`, `AppState.current` stays `'active'` and its subscriptions never fire (the Page Visibility API is what a future shim would use). Nothing publishes `__globalProps.fontScale` either, so `readGlobalFontScale()` returns `null` and `useFontScale()` stays at `1`.

## License

MIT
