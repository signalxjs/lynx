import type { Signal } from '@sigx/lynx';

// ---------------------------------------------------------------------------
// Touch event types (platform-agnostic, matches Lynx shape)
//
// Used by `usePinch` / `useRotation` — multi-touch JS-only fallbacks. The
// rest of the gesture surface (Tap, LongPress, Pan, Fling, Swipe) is
// arena-driven via `Gesture.*` + `useGestureDetector`; the legacy hooks
// were deleted in Phase 2.12.4.
// ---------------------------------------------------------------------------

export interface TouchPoint {
  identifier: number;
  x: number;
  y: number;
  pageX: number;
  pageY: number;
  clientX: number;
  clientY: number;
}

export interface TouchEvent {
  touches: TouchPoint[];
  changedTouches: TouchPoint[];
}

// ---------------------------------------------------------------------------
// Gesture phase
// ---------------------------------------------------------------------------

export type GesturePhase = 'idle' | 'began' | 'active' | 'ended' | 'cancelled';

// ---------------------------------------------------------------------------
// Bind-prop handler bag (spread onto an element's main-thread-bindtouch* attrs)
// ---------------------------------------------------------------------------

export interface GestureHandlers {
  bindtouchstart?: (e: TouchEvent) => void;
  bindtouchmove?: (e: TouchEvent) => void;
  bindtouchend?: (e: TouchEvent) => void;
  bindtouchcancel?: (e: TouchEvent) => void;
}

// ---------------------------------------------------------------------------
// Pinch
// ---------------------------------------------------------------------------

export interface PinchState {
  phase: GesturePhase;
  scale: number;
  focalX: number;
  focalY: number;
}

export interface UsePinchOptions {
  onPinch?: (state: PinchState) => void;
}

export interface UsePinchReturn {
  state: Signal<PinchState>;
  handlers: GestureHandlers;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export interface RotationState {
  phase: GesturePhase;
  /** Cumulative rotation in radians since gesture start (signed). */
  rotation: number;
  /** Angular velocity in radians/ms. */
  velocity: number;
  focalX: number;
  focalY: number;
}

export interface UseRotationOptions {
  onRotation?: (state: RotationState) => void;
}

export interface UseRotationReturn {
  state: Signal<RotationState>;
  handlers: GestureHandlers;
  reset: () => void;
}
