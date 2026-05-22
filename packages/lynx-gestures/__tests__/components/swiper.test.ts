import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import {
  Swiper,
  useSwiperDotProgress,
  useSwiperDotScale,
  useSwiperDotGrowX,
  useSwiperDotWidth,
  useSwiperDotTranslate,
} from '../../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/components/Swiper.tsx');
const HOOKS = resolve(HERE, '../../src/use-swiper-dot-progress.ts');

describe('Swiper', () => {
  it('is exported as a component factory', () => {
    expect(typeof Swiper).toBe('function');
  });

  it('renders a native <scroll-view paging-enabled scroll-orientation="horizontal">', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/<scroll-view/);
    expect(src).toMatch(/paging-enabled/);
    expect(src).toMatch(/scroll-orientation="horizontal"/);
  });

  it('writes scroll offset to a SharedValue from a main-thread bindscroll', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/main-thread-bindscroll/);
    expect(src).toMatch(/'main thread'/);
    expect(src).toMatch(/offset\.current\.value\s*=\s*e\.detail\.scrollLeft/);
    // The inline __FlushElementTree call is what makes the SharedValue write
    // visible on the same vsync frame.
    expect(src).toMatch(/__FlushElementTree/);
  });

  it('emits pageChange on integer page boundary from BG bindscroll', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/bindscroll=/);
    expect(src).toMatch(/Math\.round\(/);
    expect(src).toMatch(/emit\('pageChange'/);
  });

  it('no longer ships SwiperDots — headless hooks only', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).not.toMatch(/\bSwiperDots\b/);
    expect(src).not.toMatch(/\bconst SwiperDot\b/);
  });
});

describe('swiper-dot headless hooks', () => {
  it('exports five hooks for indicator authoring', () => {
    expect(typeof useSwiperDotProgress).toBe('function');
    expect(typeof useSwiperDotScale).toBe('function');
    expect(typeof useSwiperDotGrowX).toBe('function');
    expect(typeof useSwiperDotWidth).toBe('function');
    expect(typeof useSwiperDotTranslate).toBe('function');
  });

  it('useSwiperDotProgress binds the opacity channel with a clamped triangular range', () => {
    const src = readFileSync(HOOKS, 'utf8');
    // Channel name is captured as a primitive string so the worklet
    // transform can lift it.
    expect(src).toMatch(/channel:\s*'opacity'/);
    expect(src).toMatch(/inputRange:\s*\[center\s*-\s*w,\s*center,\s*center\s*\+\s*w\]/);
    expect(src).toMatch(/extrapolate:\s*'clamp'/);
  });

  it('useSwiperDotScale targets uniform scale with sensible defaults', () => {
    const src = readFileSync(HOOKS, 'utf8');
    expect(src).toMatch(/channel:\s*'scale'/);
    expect(src).toMatch(/active\s*=\s*opts\.active\s*\?\?\s*1\.4/);
  });

  it('useSwiperDotGrowX uses the transform-only scaleX channel', () => {
    const src = readFileSync(HOOKS, 'utf8');
    expect(src).toMatch(/channel:\s*'scaleX'/);
  });

  it('useSwiperDotWidth animates layout-width in CSS pixels', () => {
    const src = readFileSync(HOOKS, 'utf8');
    expect(src).toMatch(/channel:\s*'width'/);
  });

  it('useSwiperDotTranslate drives a single translateX binding scaled by step/pageWidth', () => {
    const src = readFileSync(HOOKS, 'utf8');
    expect(src).toMatch(/useAnimatedStyle\(ref,\s*opts\.offset,\s*'translateX'/);
    expect(src).toMatch(/opts\.step\s*\/\s*opts\.pageWidth/);
  });
});
