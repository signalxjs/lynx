/**
 * Unit tests for the pinch/rotation JS surface. The gesture itself is native
 * (UIKit `UIPinch`/`UIRotationGestureRecognizer` on iOS, `ScaleGestureDetector`
 * + a rotation tracker on Android) and is exercised on-device — this only
 * covers the type augmentation and that the package re-exports the component.
 */
import { describe, it, expect } from 'vitest';
import '../src/jsx-augment.js';
import { PinchRotate } from '../src/index.js';
import type {
  SigxPinchAttributes,
  PinchGestureStartEvent,
  PinchGestureChangeEvent,
  PinchGestureEndEvent,
} from '../src/index.js';

describe('PinchRotate export', () => {
  it('is re-exported from the package entry', () => {
    expect(PinchRotate).toBeTypeOf('function');
  });
});

describe('jsx-augment', () => {
  it('SigxPinchAttributes accepts the documented prop + event shape', () => {
    const attrs: SigxPinchAttributes = {
      'min-scale': 1,
      'max-scale': 5,
      'enable-rotation': true,
      enabled: true,
      bindgesturestart: (e) => { void e.detail.focalX; },
      bindgesturechange: (e) => { void e.detail.scale; void e.detail.rotation; },
      bindgestureend: (e) => { void e.detail.scale; },
    };
    expect(attrs['max-scale']).toBe(5);
    expect(attrs['enable-rotation']).toBe(true);
  });

  it('event detail shapes match the native wire format', () => {
    const start: PinchGestureStartEvent = {
      type: 'gesturestart',
      detail: { focalX: 10, focalY: 20 },
    };
    const change: PinchGestureChangeEvent = {
      type: 'gesturechange',
      detail: { scale: 2, rotation: Math.PI / 4, focalX: 10, focalY: 20 },
    };
    const end: PinchGestureEndEvent = {
      type: 'gestureend',
      detail: { scale: 2, rotation: Math.PI / 4 },
    };
    expect(start.detail.focalX).toBe(10);
    expect(change.detail.scale).toBe(2);
    expect(end.detail.rotation).toBeCloseTo(Math.PI / 4);
  });

  it('declares <sigx-pinch> on the global JSX namespace', () => {
    // Type-level assertion — compiles only if the intrinsic is registered.
    const el: JSX.IntrinsicElements['sigx-pinch'] = { 'max-scale': 3 };
    expect(el['max-scale']).toBe(3);
  });
});
