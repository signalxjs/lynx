# @sigx/lynx-core

Low-level native-module bridge for sigx-lynx. Every `@sigx/lynx-*` native module package (`-camera`, `-haptics`, `-storage`, `-network`, …) depends on this for its iOS/Android plumbing.

Most apps don't import this directly — they use the module packages by name.

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

Native modules are wired by `@sigx/lynx-cli`'s autolinker — list them under `modules: [...]` in `sigx.lynx.config.ts`, run `sigx prebuild`, and the generated registry takes care of the rest.
