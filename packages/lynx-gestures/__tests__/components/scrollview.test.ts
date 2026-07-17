/**
 * `<ScrollView>` tests — the scroll-drag-host adoption contract plus
 * source-shape pins for the MT pieces (the bindscroll worklet runs in the
 * Lynx main-thread bundle, not under vitest — same rationale as
 * draggable.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { ScrollView } from '../../src/index';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/components/ScrollView.tsx');

describe('ScrollView', () => {
  const src = readFileSync(SRC, 'utf8');

  it('is exported as a component factory', () => {
    expect(typeof ScrollView).toBe('function');
  });

  it('adopts an ancestor ScrollDragHost for vertical orientation only', () => {
    expect(src).toContain('useScrollDragHost()');
    expect(src).toMatch(/dragHost && vertical \? dragHost\.adoptVerticalScroll\(\)/);
  });

  it('adopted: mirrors the live offset into the host SV from the bindscroll worklet', () => {
    const bindscroll = src.slice(src.indexOf('main-thread-bindscroll'));
    expect(bindscroll).toContain(
      'if (adopted === 1) hostOffsetY.current.value = e.detail.scrollTop;',
    );
  });

  it('adopted: flags hasVerticalScroll on mount and zeroes both handles on release', () => {
    expect(src).toMatch(/hostHasScroll\.current\.value = 1;/);
    const unmount = src.slice(src.indexOf('onUnmounted'));
    expect(unmount).toContain('hostRelease?.()');
    expect(unmount).toContain('hostHasScroll.current.value = 0;');
    expect(unmount).toContain('hostOffsetY.current.value = 0;');
  });

  it('composes the host scrollLock into enable-scroll (verticals only)', () => {
    expect(src).toContain(
      "const hostLocked = dragHost && vertical ? dragHost.scrollLock.value : false;",
    );
    expect(src).toContain(
      "const enableScroll = userEnableScroll && !dragging.value && !hostLocked;",
    );
  });

  it('adopted: pins bounces off so `offset <= 0` reads stay truthful on iOS', () => {
    expect(src).toMatch(/bounces=\{adopted === 1 \? false : undefined\}/);
  });

  it('adopted: binds the host-allocated element ref (one identity for host + context)', () => {
    expect(src).toMatch(/dragHost\.scrollRef : scrollViewRef/);
    expect(src).toMatch(/main-thread:ref=\{elRef\}/);
    expect(src).toMatch(/scrollViewRef: elRef/);
  });
});
