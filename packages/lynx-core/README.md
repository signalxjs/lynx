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

## Permissions helpers

For modules that need runtime permissions (camera, location, notifications, …) the package re-exports the shared `PermissionStatus` / `PermissionResponse` types used by `@sigx/lynx-permissions`.

## Shared native helpers

Besides the JS bridge, the package ships a small shared native runtime that the autolinker copies into the generated project whenever any native module is installed (the package is discovered transitively — modules depend on `@sigx/lynx-core`, so apps never declare it for this):

- **Android — `com.sigx.core.SigxActivityHolder`**: weak reference to the current foreground Activity, fed by the auto-linked `SigxActivityHook` lifecycle hook. Modules that present platform UI (`BiometricPrompt`, `DatePickerDialog`, permission dialogs, …) read `current()` or `currentFragmentActivity()` at call time instead of each shipping their own holder.
- **iOS — `SigxPresentation.topPresenter()`**: top-most `UIViewController` on the active scene's key window (multi-scene safe, walks the presented-modal chain). Used by the picker modules to present sheets.

Module authors: don't add a per-package Activity holder or top-presenter helper — use these.

## Linking

Native modules are wired by `@sigx/lynx-cli`'s autolinker. Install the package (`pnpm add @sigx/lynx-foo`), run `sigx prebuild`, and the generated registry takes care of the rest — the `signalx-module.json` manifest each module ships is what makes auto-discovery work.
