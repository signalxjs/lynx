import { describe, it, expect } from 'vitest';
import { usePinch, useRotation } from '../src/index';

// Synthetic touch event helpers — used by the multi-touch JS-only fallback
// hooks (`usePinch`, `useRotation`). Phase 2.12.4 deleted the legacy single-
// touch hooks; the surface tested here is the remainder until Lynx's native
// arena ships pinch / rotation handlers.

function touchEvent(touches: Array<{ pageX: number; pageY: number; identifier?: number }>) {
  return {
    type: 'touch',
    timestamp: Date.now(),
    touches: touches.map((t, i) => ({
      identifier: t.identifier ?? i + 1,
      x: t.pageX,
      y: t.pageY,
      pageX: t.pageX,
      pageY: t.pageY,
      clientX: t.pageX,
      clientY: t.pageY,
    })),
    changedTouches: touches.map((t, i) => ({
      identifier: t.identifier ?? i + 1,
      x: t.pageX,
      y: t.pageY,
      pageX: t.pageX,
      pageY: t.pageY,
      clientX: t.pageX,
      clientY: t.pageY,
    })),
    target: { id: '', dataset: {}, uid: 0 },
    currentTarget: { id: '', dataset: {}, uid: 0 },
    detail: {},
  } as any;
}

describe('usePinch', () => {
  it('detects two-finger zoom', () => {
    const pinch = usePinch();

    pinch.handlers.bindtouchstart!(touchEvent([{ pageX: 100, pageY: 100 }]));
    expect(pinch.state.phase).toBe('idle');

    pinch.handlers.bindtouchstart!(touchEvent([{ pageX: 200, pageY: 200 }]));
    expect(pinch.state.phase).toBe('began');
    expect(pinch.state.scale).toBe(1);

    pinch.handlers.bindtouchmove!(touchEvent([{ pageX: 50, pageY: 50 }]));
    pinch.handlers.bindtouchmove!(touchEvent([{ pageX: 250, pageY: 250 }]));
    expect(pinch.state.phase).toBe('active');
    expect(pinch.state.scale).toBeGreaterThan(1);
  });

  it('detects pinch in (zoom out)', () => {
    const pinch = usePinch();

    pinch.handlers.bindtouchstart!(touchEvent([{ pageX: 50, pageY: 50 }]));
    pinch.handlers.bindtouchstart!(touchEvent([{ pageX: 250, pageY: 250 }]));

    pinch.handlers.bindtouchmove!(touchEvent([{ pageX: 120, pageY: 120 }]));
    pinch.handlers.bindtouchmove!(touchEvent([{ pageX: 180, pageY: 180 }]));
    expect(pinch.state.scale).toBeLessThan(1);
  });

  it('ends on touch end', () => {
    const pinch = usePinch();

    pinch.handlers.bindtouchstart!(touchEvent([{ pageX: 100, pageY: 100 }]));
    pinch.handlers.bindtouchstart!(touchEvent([{ pageX: 200, pageY: 200 }]));
    pinch.handlers.bindtouchend!(touchEvent([]));

    expect(pinch.state.phase).toBe('ended');
  });
});

describe('useRotation', () => {
  it('begins on second finger and reports zero rotation initially', () => {
    const rot = useRotation();

    rot.handlers.bindtouchstart!(touchEvent([{ pageX: 100, pageY: 100 }]));
    expect(rot.state.phase).toBe('idle');

    rot.handlers.bindtouchstart!(touchEvent([{ pageX: 200, pageY: 100 }]));
    expect(rot.state.phase).toBe('began');
    expect(rot.state.rotation).toBe(0);
    expect(rot.state.focalX).toBe(150);
    expect(rot.state.focalY).toBe(100);
  });

  it('reports positive rotation when second finger rotates clockwise (down)', () => {
    const rot = useRotation();

    rot.handlers.bindtouchstart!(touchEvent([{ pageX: 100, pageY: 100 }]));
    rot.handlers.bindtouchstart!(touchEvent([{ pageX: 200, pageY: 100 }]));

    rot.handlers.bindtouchmove!(touchEvent([{ pageX: 200, pageY: 200 }]));

    expect(rot.state.phase).toBe('active');
    expect(rot.state.rotation).toBeCloseTo(Math.PI / 4, 2);
  });

  it('ends on touchend', () => {
    const rot = useRotation();
    rot.handlers.bindtouchstart!(touchEvent([{ pageX: 100, pageY: 100 }]));
    rot.handlers.bindtouchstart!(touchEvent([{ pageX: 200, pageY: 100 }]));
    rot.handlers.bindtouchend!(touchEvent([]));
    expect(rot.state.phase).toBe('ended');
  });

  it('resets state', () => {
    const rot = useRotation();
    rot.handlers.bindtouchstart!(touchEvent([{ pageX: 100, pageY: 100 }]));
    rot.handlers.bindtouchstart!(touchEvent([{ pageX: 200, pageY: 100 }]));
    rot.handlers.bindtouchmove!(touchEvent([{ pageX: 200, pageY: 200 }]));
    rot.reset();
    expect(rot.state.phase).toBe('idle');
    expect(rot.state.rotation).toBe(0);
  });
});
