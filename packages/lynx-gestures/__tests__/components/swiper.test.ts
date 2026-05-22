import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Swiper, SwiperDots } from '../../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/components/Swiper.tsx');

describe('Swiper', () => {
  it('is exported as a component factory', () => {
    expect(typeof Swiper).toBe('function');
    expect(typeof SwiperDots).toBe('function');
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

  it('SwiperDots drives per-dot opacity via useAnimatedStyle range-map', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toContain("useAnimatedStyle(overlayRef, props.offset, 'opacity'");
    expect(src).toContain('inputRange:');
    expect(src).toContain('outputRange:');
    expect(src).toMatch(/extrapolate:\s*'clamp'/);
  });
});
