/// <reference types="@sigx/lynx-runtime" />
// Side-effect import: registers lynxMount as the default mount, installs
// the platform model processor, augments PlatformTypes with ShadowElement,
// and adds the global JSX intrinsic element types for <view>, <text>, etc.
import '@sigx/lynx-runtime';

// Side-effect import: installs `fetch`/`Headers`/`FormData`/`Response`
// (and a TextDecoder shim) on `globalThis`. Older Lynx BG runtimes shipped no
// fetch at all; Lynx 0.5.0+ ships its own (non-WHATWG) one as a factory
// parameter. Either way the install patches `globalThis.fetch` so that and the
// re-export below bind to the sigx implementation — but a BARE `fetch(...)`
// still resolves to the factory parameter, so app code should import `fetch`
// (below) or call `globalThis.fetch(...)`, never a bare `fetch()`. The CLI
// default-wires the native Http module via the umbrella's dependency entry.
import '@sigx/lynx-http';

// Re-export the networking surface so app code binds to the sigx fetch with a
// plain `import { fetch } from '@sigx/lynx'`. This is REQUIRED on the Lynx BG
// runtime: the bundle is wrapped in one `tt.define(…, function(…, fetch, …))`
// factory, so a *bare* `fetch` identifier resolves to the engine's factory
// parameter (a non-WHATWG fetch whose `Response` has no `.headers`), NOT the
// `globalThis.fetch` the side-effect above patches. Importing binds `fetch`
// (and friends) to the sigx implementation, which is the only reliable way to
// get a spec `Response` on-device. See signalxjs/lynx#373, #378.
export { fetch, FormData, Headers, Response, TextDecoder, isHttpAvailable } from '@sigx/lynx-http';
export type {
    RequestInitLike,
    BodyInitLike,
    AbortSignalLike,
    HeadersInitLike,
    FileHandleLike,
    FormDataEntryValueLike,
} from '@sigx/lynx-http';

// Re-export the public surface so users only need a single import:
//
//     import { component, signal, defineApp, type Define } from '@sigx/lynx';
//
// Mirrors the layering of `sigx` (web meta) and `@sigx/terminal` (terminal meta).
export * from '@sigx/reactivity';
export * from '@sigx/runtime-core';
export * from '@sigx/lynx-runtime';

// Logging — re-export just the leveled/namespaced logger from @sigx/lynx-core
// so app code uses the blessed `@sigx/lynx` import. The low-level bridge
// (`getModule`/`callAsync`/…) stays internal to `@sigx/lynx-core` on purpose.
export {
    createLogger,
    setLogLevel,
    getLogLevel,
    enableNamespace,
    disableNamespace,
    addTransport,
    clearTransports,
    consoleTransport,
} from '@sigx/lynx-core';
export type { Logger, LogLevelName, LogRecord, LogTransport } from '@sigx/lynx-core';

// Internal-use re-export, needed by the HMR loader. The loader injects an
// import of `__setCurrentInstanceForHMR` alongside `__registerComponentPlugin`
// so the HMR runtime can push the current ctx onto the renderer's instance
// stack before re-running a screen's setup function. Without this, hooks
// like `useNav()` that resolve through provide/inject throw during the HMR
// re-execution because the active instance is `null`.
export { setCurrentInstance as __setCurrentInstanceForHMR } from '@sigx/runtime-core/internals';
