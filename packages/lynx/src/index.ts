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
