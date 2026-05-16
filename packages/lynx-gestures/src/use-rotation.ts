import { signal } from '@sigx/lynx';
import type {
  UseRotationOptions,
  UseRotationReturn,
  TouchEvent,
  TouchPoint,
  RotationState,
} from './types.js';
import { angle, angleDelta, distance, midpoint } from './utils.js';

/**
 * Two-finger rotation gesture.
 *
 * Tracks the angle of the line between two fingers; reports cumulative rotation
 * in radians from gesture start. Like usePinch, uses proximity-based finger
 * matching on touchmove (Lynx touch identifiers are not stable across events).
 *
 * NOTE: requires multi-touch delivery to the same element. Some Lynx hosts
 * (Lynx Explorer on emulator) may not support this — test on a physical device.
 */
export function useRotation(options: UseRotationOptions = {}): UseRotationReturn {
  const { onRotation } = options;

  const state = signal<RotationState>({
    phase: 'idle',
    rotation: 0,
    velocity: 0,
    focalX: 0,
    focalY: 0,
  });

  let baseAngle = 0;
  let prevAngle = 0;
  let prevTime = 0;
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
      baseAngle = angle(finger1.pageX, finger1.pageY, finger2.pageX, finger2.pageY);
      prevAngle = baseAngle;
      prevTime = Date.now();
      const [fx, fy] = midpoint(finger1.pageX, finger1.pageY, finger2.pageX, finger2.pageY);
      state.phase = 'began';
      state.rotation = 0;
      state.velocity = 0;
      state.focalX = fx;
      state.focalY = fy;
    }
  }

  function onTouchMove(e: TouchEvent): void {
    if (!active || !finger1 || !finger2) return;
    const t = e.changedTouches[0];
    if (!t) return;

    const dist1 = distance(t.pageX, t.pageY, finger1.pageX, finger1.pageY);
    const dist2 = distance(t.pageX, t.pageY, finger2.pageX, finger2.pageY);
    if (dist1 < dist2) {
      finger1 = { ...t };
    } else {
      finger2 = { ...t };
    }

    const now = Date.now();
    const dt = Math.max(now - prevTime, 1);
    const currentAngle = angle(finger1.pageX, finger1.pageY, finger2.pageX, finger2.pageY);
    const rotation = angleDelta(baseAngle, currentAngle);
    const velocity = angleDelta(prevAngle, currentAngle) / dt;
    const [fx, fy] = midpoint(finger1.pageX, finger1.pageY, finger2.pageX, finger2.pageY);

    prevAngle = currentAngle;
    prevTime = now;

    state.phase = 'active';
    state.rotation = rotation;
    state.velocity = velocity;
    state.focalX = fx;
    state.focalY = fy;
    onRotation?.(state as RotationState);
  }

  function onTouchEnd(): void {
    if (active) {
      state.phase = 'ended';
      onRotation?.(state as RotationState);
    }
    active = false;
    finger1 = null;
    finger2 = null;
  }

  function onTouchCancel(): void {
    if (active) state.phase = 'cancelled';
    active = false;
    finger1 = null;
    finger2 = null;
  }

  function reset(): void {
    active = false;
    finger1 = null;
    finger2 = null;
    state.phase = 'idle';
    state.rotation = 0;
    state.velocity = 0;
    state.focalX = 0;
    state.focalY = 0;
  }

  return {
    state,
    handlers: {
      bindtouchstart: onTouchStart,
      bindtouchmove: onTouchMove,
      bindtouchend: onTouchEnd,
      bindtouchcancel: onTouchCancel,
    },
    reset,
  };
}
