import { signal } from '@sigx/lynx';
import type { UsePinchOptions, UsePinchReturn, TouchEvent, PinchState, TouchPoint } from './types.js';
import { distance, midpoint } from './utils.js';

/**
 * Two-finger pinch/zoom gesture.
 *
 * Tracks fingers manually since Lynx fires separate touchstart events per
 * finger (each with touches.length=1). Uses proximity-based matching on
 * touchmove since Lynx identifiers are unreliable across events.
 *
 * NOTE: Requires a device/environment that delivers multi-touch events to
 * the same element. Some Lynx hosts (e.g. Lynx Explorer on emulator) may
 * not support this — test on a physical device.
 */
export function usePinch(options: UsePinchOptions = {}): UsePinchReturn {
  const { onPinch } = options;

  const state = signal<PinchState>({
    phase: 'idle',
    scale: 1,
    focalX: 0,
    focalY: 0,
  });

  let baseDistance = 0;
  let active = false;
  let finger1: TouchPoint | null = null;
  let finger2: TouchPoint | null = null;

  function onTouchStart(e: TouchEvent): void {
    const t = e.touches[0];
    if (!t) return;

    if (!finger1) {
      finger1 = { ...t };
    } else if (!finger2) {
      finger2 = { ...t };
      active = true;
      baseDistance = distance(finger1.pageX, finger1.pageY, finger2.pageX, finger2.pageY);
      const [fx, fy] = midpoint(finger1.pageX, finger1.pageY, finger2.pageX, finger2.pageY);
      state.phase = 'began';
      state.scale = 1;
      state.focalX = fx;
      state.focalY = fy;
    }
  }

  function onTouchMove(e: TouchEvent): void {
    if (!active || !finger1 || !finger2) return;

    const t = e.changedTouches[0];
    if (!t) return;

    // Determine which finger moved by proximity
    const dist1 = distance(t.pageX, t.pageY, finger1.pageX, finger1.pageY);
    const dist2 = distance(t.pageX, t.pageY, finger2.pageX, finger2.pageY);

    if (dist1 < dist2) {
      finger1 = { ...t };
    } else {
      finger2 = { ...t };
    }

    const currentDist = distance(finger1.pageX, finger1.pageY, finger2.pageX, finger2.pageY);
    const scale = baseDistance > 0 ? currentDist / baseDistance : 1;
    const [fx, fy] = midpoint(finger1.pageX, finger1.pageY, finger2.pageX, finger2.pageY);

    state.phase = 'active';
    state.scale = scale;
    state.focalX = fx;
    state.focalY = fy;
    onPinch?.(state as PinchState);
  }

  function onTouchEnd(): void {
    if (active) {
      state.phase = 'ended';
      onPinch?.(state as PinchState);
    }
    active = false;
    finger1 = null;
    finger2 = null;
  }

  function reset(): void {
    active = false;
    finger1 = null;
    finger2 = null;
    state.phase = 'idle';
    state.scale = 1;
    state.focalX = 0;
    state.focalY = 0;
  }

  return {
    state,
    handlers: {
      bindtouchstart: onTouchStart,
      bindtouchmove: onTouchMove,
      bindtouchend: onTouchEnd,
      bindtouchcancel: onTouchEnd,
    },
    reset,
  };
}
