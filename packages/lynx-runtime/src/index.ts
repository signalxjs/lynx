// Side-effect: importing this module registers lynxMount as the default mount,
// installs the platform model processor, augments PlatformTypes, and adds the
// global JSX intrinsic element types. Only activate when the app explicitly
// imports '@sigx/lynx-runtime'.
/// <reference path="./shims.d.ts" />
// Side-effect (FIRST): install web-standard globals the Lynx BG thread doesn't
// expose (e.g. queueMicrotask). Imported before everything else so its globals
// are in place before any other module's side effects. See signalxjs/lynx#296.
import './install-globals.js';
// Side-effect: tell core this runtime is a live client, not a server render.
// Must precede any component setup that calls `useData`/`useAction` — core
// skips the fetcher entirely when `isLiveClient()` is false, and its fallback
// (`typeof window`) is false on the BG thread. See ./live-client.ts.
import './live-client.js';
import './jsx.js';
import './types.js';
import './model-processor.js';
// Side-effect: register the built-in `show` directive + its JSX type so the
// `use:show` shorthand resolves at runtime and gets IntelliSense.
import './directives/register.js';
// Side-effect: subscribes to Lynx.Sigx.PublishEvent on the JS context so
// MT-side hybrid worklets can fire BG handlers via the existing event-registry.
import './bg-bridge.js';
// Side-effect (lazy): imports the runOnBackground module so its listener can
// be registered on the first registerWorkletCtx() call. The module's init()
// is gated to first-use, so this import is cheap.
import './run-on-background.js';

export { render, lynxMount } from './render.js';
export { nodeOps, resetNodeOpsState } from './nodeOps.js';
export type { LynxNode, LynxElement } from './nodeOps.js';
export { ShadowElement, createPageRoot, resetShadowState } from './shadow-element.js';
export {
  ShadowSlotElement,
  ShadowSnapshotElement,
  isShadowSlotElement,
  isShadowSnapshotElement,
} from './shadow-snapshot.js';
export { normalizeHole, releaseHoleValues, wireEqual } from './snapshot-values.js';

// use:* directive system + the built-in `show` directive. The directive
// lifecycle hooks are wired into nodeOps; `show` is registered with the
// platform on import (see ./directives/register.js).
export { show } from './directives/show.js';
export {
  registerBuiltInDirective,
  resolveBuiltInDirective,
  patchDirective,
  onElementMounted,
  onElementUnmounted,
} from './directives/index.js';
export type { LynxDirective, DirectiveHost, DirectiveState } from './directives/index.js';
export { pushOp, takeOps, scheduleFlush, flushNow, resetOpQueue, waitForFlush, pendingOps } from './op-queue.js';
export { OP } from '@sigx/lynx-runtime-internal';
export type {
  OpCode,
  MapperParams,
  RangeParams,
  BuiltinMapperName,
  AnimatedStyleMapper,
} from '@sigx/lynx-runtime-internal';
export {
  register,
  updateHandler,
  unregister,
  getHandler,
  publishEvent,
  resetRegistry,
} from './event-registry.js';

// ---------------------------------------------------------------------------
// Main Thread Script (MTS) APIs
// ---------------------------------------------------------------------------

export {
  MainThreadRef,
  useMainThreadRef,
  resetWvidCounter,
} from './main-thread-ref.js';

export { useElementLayout } from './use-element-layout.js';
export type {
  ElementLayout,
  LayoutChangeEvent,
  UseElementLayoutResult,
} from './use-element-layout.js';

export {
  registerBgSink,
  unregisterBgSink,
  ingestAvPublishes,
  resetBgAvBridge,
  bgAvSinkCount,
} from './animated-bridge.js';

export {
  useSharedValue,
  SharedValue,
} from './animated/shared-value.js';
export type { SharedValueState } from './animated/shared-value.js';
export {
  useAnimatedStyle,
  resetAnimatedStyleBindingIds,
} from './animated/use-animated-style.js';
export type { AnimatedStyleSpec } from './animated/use-animated-style.js';
export {
  useDerivedValue,
  useDerivedValueReactive,
} from './animated/derived-value.js';
export type { DerivedReducerName, DerivedReducerParams } from './animated/derived-value.js';
export {
  useScrollDragHost,
  useCreateScrollDragHost,
} from './scroll-drag-host.js';
export type { ScrollDragHost } from './scroll-drag-host.js';

// @deprecated since Phase 2.8 — use `SharedValue` / `useSharedValue` /
// `SharedValueState` instead. Kept for one minor cycle.
export {
  useAnimatedValue,
  AnimatedValue,
} from './animated/animated-value.js';
export type { AnimatedValueState } from './animated/animated-value.js';

export {
  runOnMainThread,
  runOnBackground,
  resetThreading,
  transformToWorklet,
  resetRunOnBackgroundState,
} from './threading.js';

// ---------------------------------------------------------------------------
// Native gesture detector — Gesture builder + useGestureDetector hook
// ---------------------------------------------------------------------------

export {
  Gesture,
  GestureType,
  useGestureDetector,
  resetGestureIdCounter,
} from './native/index.js';
export type {
  GestureTypeValue,
  GestureWorklet,
  GestureCallback,
  BaseGesture,
  ComposedGesture,
  AnyGesture,
} from './native/index.js';

// Re-export Lynx JSX attribute types so users can write
//   import type { ViewAttributes } from '@sigx/lynx-runtime'
// the same way they would from runtime-dom.
export type { DirectiveAttribute } from './jsx.js';
export type {
  LynxEventHandler,
  LynxCommonAttributes,
  ViewAttributes,
  TextAttributes,
  ImageAttributes,
  ScrollViewAttributes,
  ListAttributes,
  ListItemAttributes,
  InputAttributes,
  TextAreaAttributes,
  PageAttributes,
  SvgAttributes,
  FilterImageAttributes,
  MainThread,
} from './jsx.js';
