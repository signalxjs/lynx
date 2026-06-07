# @sigx/lynx-core

> **Low-level internals.** Most app code should import from [`@sigx/lynx`](https://github.com/signalxjs/lynx/tree/main/packages/lynx) or the specific module package (`@sigx/lynx-camera`, `@sigx/lynx-haptics`, …). This package's API is intended for authors of new native modules.

Low-level native-module bridge for sigx-lynx. Every `@sigx/lynx-*` native module package (`-camera`, `-haptics`, `-storage`, `-network`, …) depends on this for its iOS/Android plumbing.

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

## Permissions helpers

For modules that need runtime permissions (camera, location, notifications, …) the package re-exports the shared `PermissionStatus` / `PermissionResponse` types used by `@sigx/lynx-permissions`.

## Shared native helpers

Besides the JS bridge, the package ships a small shared native runtime that the autolinker copies into the generated project whenever any native module is installed (the package is discovered transitively — modules depend on `@sigx/lynx-core`, so apps never declare it for this):

- **Android — `com.sigx.core.SigxActivityHolder`**: weak reference to the current foreground Activity, fed by the auto-linked `SigxActivityHook` lifecycle hook. Modules that present platform UI (`BiometricPrompt`, `DatePickerDialog`, permission dialogs, …) read `current()` or `currentFragmentActivity()` at call time instead of each shipping their own holder.
- **iOS — `SigxPresentation.topPresenter()`**: top-most `UIViewController` on the active scene's key window (multi-scene safe, walks the presented-modal chain). Used by the picker modules to present sheets.

Module authors: don't add a per-package Activity holder or top-presenter helper — use these.

## Linking

Native modules are wired by `@sigx/lynx-cli`'s autolinker. Install the package (`pnpm add @sigx/lynx-foo`), run `sigx prebuild`, and the generated registry takes care of the rest — the `signalx-module.json` manifest each module ships is what makes auto-discovery work.
