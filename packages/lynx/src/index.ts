/// <reference types="@sigx/lynx-runtime" />
// Side-effect import: registers lynxMount as the default mount, installs
// the platform model processor, augments PlatformTypes with ShadowElement,
// and adds the global JSX intrinsic element types for <view>, <text>, etc.
import '@sigx/lynx-runtime';

// Side-effect import: installs `fetch`/`Headers`/`FormData`/`Response`
// (and a TextDecoder shim) on globalThis when absent — the Lynx BG runtime
// ships no fetch of its own. Every app that imports @sigx/lynx gets the
// web networking baseline without an explicit import; the CLI default-
// wires the native Http module via the umbrella's dependency entry.
import '@sigx/lynx-http';

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
