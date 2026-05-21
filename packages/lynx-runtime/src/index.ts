// Side-effect: importing this module registers lynxMount as the default mount,
// installs the platform model processor, augments PlatformTypes, and adds the
// global JSX intrinsic element types. Only activate when the app explicitly
// imports '@sigx/lynx-runtime'.
/// <reference path="./shims.d.ts" />
import './jsx';
import './types';
import './model-processor';
// Side-effect: subscribes to Lynx.Sigx.PublishEvent on the JS context so
// MT-side hybrid worklets can fire BG handlers via the existing event-registry.
import './bg-bridge';
// Side-effect (lazy): imports the runOnBackground module so its listener can
// be registered on the first registerWorkletCtx() call. The module's init()
// is gated to first-use, so this import is cheap.
import './run-on-background';

export { render, lynxMount } from './render';
export { nodeOps } from './nodeOps';
export type { LynxNode, LynxElement } from './nodeOps';
export { ShadowElement, createPageRoot, resetShadowState } from './shadow-element';
export { pushOp, takeOps, scheduleFlush, flushNow, resetOpQueue } from './op-queue';
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
} from './event-registry';

// ---------------------------------------------------------------------------
// Main Thread Script (MTS) APIs
// ---------------------------------------------------------------------------

export {
  MainThreadRef,
  useMainThreadRef,
  resetWvidCounter,
} from './main-thread-ref';

export { useElementLayout } from './use-element-layout';
export type {
  ElementLayout,
  LayoutChangeEvent,
  UseElementLayoutResult,
} from './use-element-layout';

export {
  registerBgSink,
  unregisterBgSink,
  ingestAvPublishes,
  resetBgAvBridge,
  bgAvSinkCount,
} from './animated-bridge';

export {
  useSharedValue,
  SharedValue,
} from './animated/shared-value';
export type { SharedValueState } from './animated/shared-value';
export {
  useAnimatedStyle,
  resetAnimatedStyleBindingIds,
} from './animated/use-animated-style';

// @deprecated since Phase 2.8 — use `SharedValue` / `useSharedValue` /
// `SharedValueState` instead. Kept for one minor cycle.
export {
  useAnimatedValue,
  AnimatedValue,
} from './animated/animated-value';
export type { AnimatedValueState } from './animated/animated-value';

export {
  runOnMainThread,
  runOnBackground,
  resetThreading,
  transformToWorklet,
  resetRunOnBackgroundState,
} from './threading';

// ---------------------------------------------------------------------------
// Native gesture detector — Gesture builder + useGestureDetector hook
// ---------------------------------------------------------------------------

export {
  Gesture,
  GestureType,
  useGestureDetector,
  resetGestureIdCounter,
} from './native/index';
export type {
  GestureTypeValue,
  GestureWorklet,
  GestureCallback,
  BaseGesture,
  ComposedGesture,
  AnyGesture,
} from './native/index';

// Re-export Lynx JSX attribute types so users can write
//   import type { ViewAttributes } from '@sigx/lynx-runtime'
// the same way they would from runtime-dom.
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
} from './jsx';
