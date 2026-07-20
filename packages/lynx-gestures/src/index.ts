// Native pinch-zoom + rotation. Lynx's gesture arena reserves the
// `PINCH`/`ROTATION` enum slots but ships no handler for them in any released
// version (the handler factory is a closed switch compiled into the
// framework), so `Gesture.Pinch()`/`Gesture.Rotation()` never fire on native.
// `<PinchRotate>` instead wraps the native `<sigx-pinch>` element, which
// attaches UIKit's `UIPinch`/`UIRotationGestureRecognizer` (iOS) and
// `ScaleGestureDetector` + a rotation tracker (Android) to its backing view
// and applies the transform on the UI thread. Requires `sigx prebuild`.
//
// This replaces the former `usePinch`/`useRotation` JS hooks, which parsed
// `bindtouch*` on the background thread and matched fingers by proximity —
// unreliable, and never smoother than the native path.
import './jsx-augment.js';
export { PinchRotate } from './components/PinchRotate.js';
export type { PinchRotateProps } from './components/PinchRotate.js';
export type {
  SigxPinchAttributes,
  PinchGestureStartEvent,
  PinchGestureStartDetail,
  PinchGestureChangeEvent,
  PinchGestureChangeDetail,
  PinchGestureEndEvent,
  PinchGestureEndDetail,
} from './jsx-augment.js';

// Cross-thread value primitive — re-exported from @sigx/lynx for back-compat.
// @deprecated since 0.3.0 — import directly from '@sigx/lynx' instead.
// The primitives moved out of @sigx/lynx-gestures in Phase 2.6 because they
// have no gesture coupling (SharedValue extends MainThreadRef and the
// bridge plumbing already lives in the runtime packages).
export {
  useSharedValue,
  SharedValue,
  // @deprecated — kept for back-compat. Use `useSharedValue` / `SharedValue`.
  useAnimatedValue,
  AnimatedValue,
  useAnimatedStyle,
  resetAnimatedStyleBindingIds,
} from '@sigx/lynx';
export type {
  SharedValueState,
  // @deprecated — use `SharedValueState`.
  AnimatedValueState,
  BuiltinMapperName,
  MapperParams,
} from '@sigx/lynx';

// Built-in MT components (arena-driven via `Gesture.*` + `useGestureDetector`).
export { Pressable } from './components/Pressable.js';
export type { PressableProps } from './components/Pressable.js';
export { Draggable } from './components/Draggable.js';
export type { DraggableProps, DragEndDetail } from './components/Draggable.js';
export { Swipeable } from './components/Swipeable.js';
export type { SwipeableProps, SwipeSide } from './components/Swipeable.js';
export { ScrollView } from './components/ScrollView.js';
export type { ScrollViewProps } from './components/ScrollView.js';
export { Swiper } from './components/Swiper.js';
export type { SwiperProps } from './components/Swiper.js';
export {
  useSwiperDotProgress,
  useSwiperDotScale,
  useSwiperDotGrowX,
  useSwiperDotWidth,
  useSwiperDotTranslate,
} from './use-swiper-dot-progress.js';
export type {
  SwiperDotHookInputs,
  UseSwiperDotProgressOptions,
  UseSwiperDotTranslateOptions,
} from './use-swiper-dot-progress.js';

// ScrollView ↔ child-gesture coordination (Phase 2.12.3). Public mostly so
// custom gesture components can opt in to the same auto-yield behavior that
// `<Draggable>` and `<Swipeable>` get for free.
export { useScrollContext } from './scroll-context.js';
export type { ScrollContext } from './scroll-context.js';
