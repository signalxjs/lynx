import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Swipeable } from '../../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/components/Swipeable.tsx');

describe('Swipeable', () => {
  it('is exported as a component factory', () => {
    expect(typeof Swipeable).toBe('function');
  });

  it('source attaches Gesture.Pan().axis("x") via useGestureDetector', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/Gesture\.Pan\(\)/);
    expect(src).toMatch(/\.axis\('x'\)/);
    expect(src).toMatch(/useGestureDetector\(fgRef, pan\)/);
    // Empty onBegin (iOS lifecycle gate) + onStart + onUpdate + onEnd =
    // four `'main thread'` directives at minimum.
    expect(src).toMatch(/\.onBegin\(\(\) => \{/);
    expect(src).toMatch(/\.onStart\(\(e: any\) => \{/);
    expect(src).toMatch(/\.onUpdate\(\(e: any\) => \{/);
    expect(src).toMatch(/\.onEnd\(\(\) => \{/);
    const directiveCount = (src.match(/'main thread'/g) || []).length;
    expect(directiveCount).toBeGreaterThanOrEqual(4);
    // Old bindtouch* path is fully removed.
    expect(src).not.toMatch(/main-thread-bindtouch/);
  });

  it('source reads pageX from e.params (Lynx pan event nests payload there)', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/e\.params/);
    expect(src).toMatch(/p\.pageX/);
  });

  it('source uses MTElementWrapper.animate() for snap and translateX transform', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toContain('.animate(');
    expect(src).toContain('translateX(');
  });

  it('source emits swipeOpen / swipeClose via runOnBackground', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toContain('runOnBackground');
    expect(src).toContain("emit('swipeOpen'");
    expect(src).toContain("emit('swipeClose'");
  });
});
