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

## Linking

Native modules are wired by `@sigx/lynx-cli`'s autolinker. Install the package (`pnpm add @sigx/lynx-foo`), run `sigx prebuild`, and the generated registry takes care of the rest — the `signalx-module.json` manifest each module ships is what makes auto-discovery work.
