import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Pressable } from '../../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/components/Pressable.tsx');

describe('Pressable', () => {
  it('is exported as a component factory', () => {
    expect(typeof Pressable).toBe('function');
  });

  it('source composes Gesture.Tap + Gesture.LongPress via Simultaneous, with the iOS press fallback', () => {
    const src = readFileSync(SRC, 'utf8');
    // Phase 2.12.1 hybrid: Tap.onStart emits press on Android (where it
    // fires on touchend), and LongPress.onEnd's fallback emits press on
    // iOS (where Tap.onStart never fires). State flag dedupes between
    // the two routes.
    expect(src).toMatch(/Gesture\.Tap\(\)/);
    expect(src).toMatch(/Gesture\.LongPress\(\)/);
    expect(src).toMatch(/Gesture\.Simultaneous\(tap, longPress\)/);
    expect(src).toMatch(/useGestureDetector\(elRef, gesture\)/);
    expect(src).toMatch(/\.minDuration\(longPressEnabled \? minDuration : Number\.MAX_SAFE_INTEGER\)/);
    // 5 worklets: tap.onBegin, tap.onStart, longPress.onBegin, longPress.onStart, longPress.onEnd.
    // Tap intentionally has no onEnd (iOS fires it prematurely; LongPress.onEnd resets styles).
    const directiveCount = (src.match(/'main thread'/g) || []).length;
    expect(directiveCount).toBeGreaterThanOrEqual(5);
    // pressEmitted dedupe flag wired into both paths.
    expect(src).toContain('pressEmitted');
    // Old bindtouch* path is fully removed.
    expect(src).not.toMatch(/main-thread-bindtouch/);
  });

  it('source emits press / longPress callbacks via runOnBackground', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toContain('runOnBackground');
    expect(src).toContain("emit('press')");
    expect(src).toContain("emit('longPress')");
  });

  it('source applies pressed-state styles via setStyleProperties in onBegin and resets in onEnd', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toContain('setStyleProperties');
    // Pressed flash: opacity + transform: scale(...)
    expect(src).toMatch(/opacity:\s*opacity/);
    expect(src).toMatch(/transform:\s*'scale\('\s*\+\s*scale\s*\+\s*'\)'/);
    // Reset: opacity 1, scale 1
    expect(src).toMatch(/opacity:\s*1/);
    expect(src).toMatch(/transform:\s*'scale\(1\)'/);
  });
});
