import { describe, it, expect } from 'vitest';
import { render, fireEvent, touch } from '../src/index';
import { jsx } from '@sigx/lynx';

describe('fireEvent — extras beyond render.test.tsx', () => {
  it('touch() helper produces normalized touch fields', () => {
    const t = touch(120, 80, 7);
    expect(t).toMatchObject({
      identifier: 7,
      pageX: 120,
      pageY: 80,
      x: 120,
      y: 80,
      clientX: 120,
      clientY: 80,
    });
  });

  it('touch() defaults the identifier to 1', () => {
    expect(touch(0, 0).identifier).toBe(1);
  });

  it('fires touchCancel handler', () => {
    let cancelled = false;
    const { getByType } = render(
      jsx('view', {
        bindtouchcancel: () => { cancelled = true; },
        children: [],
      }),
    );
    fireEvent.touchCancel(getByType('view'), { touches: [touch(0, 0)] });
    expect(cancelled).toBe(true);
  });

  it('fires longPress handler', () => {
    let pressed = false;
    const { getByType } = render(
      jsx('view', {
        bindlongpress: () => { pressed = true; },
        children: [],
      }),
    );
    fireEvent.longPress(getByType('view'));
    expect(pressed).toBe(true);
  });

  it('fires input handler with the supplied value', () => {
    let value = '';
    const { getByType } = render(
      jsx('input', {
        bindinput: (e: any) => { value = e.detail.value; },
        children: [],
      }),
    );
    fireEvent.input(getByType('input'), { detail: { value: 'hello' } });
    expect(value).toBe('hello');
  });

  it('routes onTap (camelCase) handlers in addition to bindtap', () => {
    let tapped = false;
    const { getByType } = render(
      jsx('view', {
        onTap: () => { tapped = true; },
        children: [],
      }),
    );
    fireEvent.tap(getByType('view'));
    expect(tapped).toBe(true);
  });

  it('passes scroll detail through with deltaX/deltaY/scrollLeft', () => {
    let detail: any = null;
    const { getByType } = render(
      jsx('scroll-view', {
        bindscroll: (e: any) => { detail = e.detail; },
        children: [],
      }),
    );
    fireEvent.scroll(getByType('scroll-view'), {
      detail: { scrollLeft: 50, deltaX: 5, deltaY: 10 },
    });
    expect(detail).toMatchObject({
      scrollLeft: 50,
      deltaX: 5,
      deltaY: 10,
      // Defaults still applied for unspecified fields:
      scrollTop: 0,
      scrollHeight: 0,
      scrollWidth: 0,
    });
  });

  it('does not throw when the target has no handler for the event', () => {
    const { getByType } = render(jsx('view', { children: [] }));
    expect(() => fireEvent.tap(getByType('view'))).not.toThrow();
    expect(() => fireEvent.scroll(getByType('view'))).not.toThrow();
  });
});
