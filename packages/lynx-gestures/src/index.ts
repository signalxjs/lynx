// Multi-touch JS-only fallback hooks. Lynx's native gesture arena ships a
// `Gesture.Pinch()` / `Gesture.Rotation()` builder pair (`GestureType.PINCH`,
// `GestureType.ROTATION`), but the platform-side handlers are unfinished
// in Lynx 3.5 — these hooks parse `bindtouch*` events directly until that
// changes. The other legacy hooks (`useTap`, `useLongPress`, `usePan`,
// `useFling`, `useSwipe`, `useGesture`, `usePanResponder`) were deleted in
// Phase 2.12.4 — use `Gesture.*` + `useGestureDetector` instead.
export { usePinch } from './use-pinch.js';
export { useRotation } from './use-rotation.js';

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
export { Swiper, SwiperDots } from './components/Swiper.js';
export type { SwiperProps, SwiperDotsProps } from './components/Swiper.js';

// ScrollView ↔ child-gesture coordination (Phase 2.12.3). Public mostly so
// custom gesture components can opt in to the same auto-yield behavior that
// `<Draggable>` and `<Swipeable>` get for free.
export { useScrollContext } from './scroll-context.js';
export type { ScrollContext } from './scroll-context.js';

// Types
export type {
  TouchPoint,
  TouchEvent,
  GesturePhase,
  GestureHandlers,
  PinchState,
  UsePinchOptions,
  UsePinchReturn,
  RotationState,
  UseRotationOptions,
  UseRotationReturn,
} from './types.js';
