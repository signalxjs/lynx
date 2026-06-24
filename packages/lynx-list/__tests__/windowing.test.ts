import { describe, it, expect } from 'vitest';
import {
  resolveWindowConfig,
  initialWindow,
  expandOlder,
  expandNewer,
  slideToEnd,
  clampWindow,
} from '../src/windowing';

describe('windowing math', () => {
  const cfg = resolveWindowConfig(60, 30, 120);

  it('resolveWindowConfig applies defaults and floors', () => {
    expect(resolveWindowConfig(undefined, undefined, undefined)).toEqual({
      windowSize: 60,
      pageSize: 30,
      maxWindow: 120,
    });
    // maxWindow defaults to max(120, windowSize*2)
    expect(resolveWindowConfig(100, 20, undefined).maxWindow).toBe(200);
    // maxWindow can't be below windowSize
    expect(resolveWindowConfig(80, 10, 40).maxWindow).toBe(80);
  });

  it('initialWindow: chat anchors to the newest, feed to the start', () => {
    expect(initialWindow(1000, cfg, true)).toEqual({ start: 940, end: 1000 });
    expect(initialWindow(1000, cfg, false)).toEqual({ start: 0, end: 60 });
    // shorter than the window → render everything
    expect(initialWindow(20, cfg, true)).toEqual({ start: 0, end: 20 });
    expect(initialWindow(0, cfg, true)).toEqual({ start: 0, end: 0 });
  });

  it('expandOlder lowers start by pageSize, clamped at 0', () => {
    expect(expandOlder({ start: 940, end: 1000 }, cfg)).toEqual({ start: 910, end: 1000 });
    expect(expandOlder({ start: 10, end: 70 }, cfg)).toEqual({ start: 0, end: 70 });
  });

  it('expandOlder trims the newest tail to maxWindow once past it', () => {
    const w = expandOlder({ start: 100, end: 210 }, cfg); // -30 → start 70, len 140 > 120
    expect(w.start).toBe(70);
    expect(w.end - w.start).toBe(cfg.maxWindow);
    expect(w.end).toBe(190); // 70 + 120
  });

  it('expandNewer raises end by pageSize, trims the oldest head past maxWindow', () => {
    expect(expandNewer({ start: 0, end: 60 }, 1000, cfg)).toEqual({ start: 0, end: 90 });
    const w = expandNewer({ start: 0, end: 200 }, 1000, cfg); // end 230, len 230 > 120
    expect(w.end).toBe(230);
    expect(w.end - w.start).toBe(cfg.maxWindow); // head trimmed to 110
    expect(w.start).toBe(110);
  });

  it('expandNewer clamps end to len', () => {
    expect(expandNewer({ start: 0, end: 80 }, 90, cfg)).toEqual({ start: 0, end: 90 });
  });

  it('slideToEnd keeps the newest and bounds to maxWindow', () => {
    expect(slideToEnd({ start: 940, end: 1000 }, 1001, cfg)).toEqual({ start: 940, end: 1001 });
    // window grew past max → start pulled up to end-maxWindow
    expect(slideToEnd({ start: 800, end: 1000 }, 1001, cfg)).toEqual({ start: 881, end: 1001 });
  });

  it('clampWindow keeps the range valid when items shrink', () => {
    expect(clampWindow({ start: 940, end: 1000 }, 500)).toEqual({ start: 500, end: 500 });
    expect(clampWindow({ start: 10, end: 50 }, 1000)).toEqual({ start: 10, end: 50 });
  });
});
