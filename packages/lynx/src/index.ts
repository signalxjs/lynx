/// <reference types="@sigx/lynx-runtime" />
// Side-effect import: registers lynxMount as the default mount, installs
// the platform model processor, augments PlatformTypes with ShadowElement,
// and adds the global JSX intrinsic element types for <view>, <text>, etc.
import '@sigx/lynx-runtime';

// Re-export the public surface so users only need a single import:
//
//     import { component, signal, defineApp, type Define } from '@sigx/lynx';
//
// Mirrors the layering of `sigx` (web meta) and `@sigx/terminal` (terminal meta).
export * from '@sigx/reactivity';
export * from '@sigx/runtime-core';
export * from '@sigx/lynx-runtime';

// Internal-use re-export, needed by the HMR loader. The loader injects an
// import of `__setCurrentInstanceForHMR` alongside `__registerComponentPlugin`
// so the HMR runtime can push the current ctx onto the renderer's instance
// stack before re-running a screen's setup function. Without this, hooks
// like `useNav()` that resolve through provide/inject throw during the HMR
// re-execution because the active instance is `null`.
export { setCurrentInstance as __setCurrentInstanceForHMR } from '@sigx/runtime-core/internals';
