/**
 * Fire synthetic events on TestNode elements.
 */
import { TestNode } from './test-node';

interface SyntheticTouch {
  identifier?: number;
  x?: number;
  y?: number;
  pageX?: number;
  pageY?: number;
  clientX?: number;
  clientY?: number;
}

interface SyntheticTouchEvent {
  touches?: SyntheticTouch[];
  changedTouches?: SyntheticTouch[];
}

interface SyntheticScrollEvent {
  detail?: {
    scrollTop?: number;
    scrollLeft?: number;
    scrollHeight?: number;
    scrollWidth?: number;
    deltaX?: number;
    deltaY?: number;
  };
}

interface SyntheticInputEvent {
  detail?: {
    value?: string;
  };
}

/** Create a normalized touch object with defaults. */
export function touch(
  pageX: number,
  pageY: number,
  identifier = 1,
): SyntheticTouch {
  return { identifier, x: pageX, y: pageY, pageX, pageY, clientX: pageX, clientY: pageY };
}

function dispatchHandler(node: TestNode, handlerKey: string, event: unknown): void {
  const handler = node._handlers.get(handlerKey);
  if (handler) handler(event);
}

function normalizeTouchEvent(data?: SyntheticTouchEvent): object {
  return {
    type: 'touch',
    timestamp: Date.now(),
    touches: data?.touches ?? [],
    changedTouches: data?.changedTouches ?? data?.touches ?? [],
    target: { id: '', dataset: {}, uid: 0 },
    currentTarget: { id: '', dataset: {}, uid: 0 },
    detail: {},
  };
}

export const fireEvent = {
  /** Fire bindtap / onTap event. */
  tap(node: TestNode, data?: { x?: number; y?: number }): void {
    const x = data?.x ?? 0;
    const y = data?.y ?? 0;
    const event = {
      type: 'tap',
      timestamp: Date.now(),
      target: { id: '', dataset: {}, uid: 0 },
      currentTarget: { id: '', dataset: {}, uid: 0 },
      detail: { x, y },
      touches: [touch(x, y)],
      changedTouches: [touch(x, y)],
    };
    dispatchHandler(node, 'bindtap', event);
    dispatchHandler(node, 'onTap', event);
  },

  /** Fire bindtouchstart event. */
  touchStart(node: TestNode, data?: SyntheticTouchEvent): void {
    dispatchHandler(node, 'bindtouchstart', normalizeTouchEvent(data));
  },

  /** Fire bindtouchmove event. */
  touchMove(node: TestNode, data?: SyntheticTouchEvent): void {
    dispatchHandler(node, 'bindtouchmove', normalizeTouchEvent(data));
  },

  /** Fire bindtouchend event. */
  touchEnd(node: TestNode, data?: SyntheticTouchEvent): void {
    dispatchHandler(node, 'bindtouchend', normalizeTouchEvent(data));
  },

  /** Fire bindtouchcancel event. */
  touchCancel(node: TestNode, data?: SyntheticTouchEvent): void {
    dispatchHandler(node, 'bindtouchcancel', normalizeTouchEvent(data));
  },

  /** Fire bindscroll event. */
  scroll(node: TestNode, data?: SyntheticScrollEvent): void {
    const event = {
      type: 'scroll',
      timestamp: Date.now(),
      target: { id: '', dataset: {}, uid: 0 },
      currentTarget: { id: '', dataset: {}, uid: 0 },
      detail: {
        scrollTop: 0,
        scrollLeft: 0,
        scrollHeight: 0,
        scrollWidth: 0,
        deltaX: 0,
        deltaY: 0,
        ...data?.detail,
      },
    };
    dispatchHandler(node, 'bindscroll', event);
    dispatchHandler(node, 'onScroll', event);
  },

  /** Fire bindinput event. */
  input(node: TestNode, data?: SyntheticInputEvent): void {
    const event = {
      type: 'input',
      timestamp: Date.now(),
      target: { id: '', dataset: {}, uid: 0 },
      currentTarget: { id: '', dataset: {}, uid: 0 },
      detail: { value: '', ...data?.detail },
    };
    dispatchHandler(node, 'bindinput', event);
    dispatchHandler(node, 'onInput', event);
  },

  /** Fire bindlongpress event. */
  longPress(node: TestNode): void {
    const event = {
      type: 'longpress',
      timestamp: Date.now(),
      target: { id: '', dataset: {}, uid: 0 },
      currentTarget: { id: '', dataset: {}, uid: 0 },
      detail: {},
    };
    dispatchHandler(node, 'bindlongpress', event);
    dispatchHandler(node, 'onLongpress', event);
  },
};
