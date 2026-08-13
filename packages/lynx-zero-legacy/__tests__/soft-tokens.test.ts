import { describe, it, expect } from 'vitest';
import { mixColors } from '../src/theme/color-mix';
import {
  completeTheme,
  registerTheme,
  extendTheme,
  colorsOf,
  type ThemeInput,
} from '../src/theme/registry';

const CORE = {
  'primary': '#0000ff', 'primary-content': '#ffffff',
  'secondary': '#ff00ff', 'secondary-content': '#ffffff',
  'accent': '#00ffff', 'accent-content': '#000000',
  'neutral': '#444444', 'neutral-content': '#ffffff',
  'base-100': '#ffffff', 'base-200': '#f0f0f0', 'base-300': '#e0e0e0',
  'base-content': '#111111',
  'info': '#0088ff', 'info-content': '#000000',
  'success': '#00cc66', 'success-content': '#000000',
  'warning': '#ffaa00', 'warning-content': '#000000',
  'error': '#ff0000', 'error-content': '#ffffff',
} as const;

const theme = (over: Partial<ThemeInput> = {}): ThemeInput => ({
  name: 'test-light', variant: 'light', colors: { ...CORE }, ...over,
});

describe('mixColors', () => {
  it('mixes hex colors linearly per channel', () => {
    expect(mixColors('#ff0000', '#ffffff', 0.5)).toBe('#ff8080');
    expect(mixColors('#000000', '#ffffff', 0.2)).toBe('#cccccc');
  });

  it('accepts #rgb shorthand and rgb()/rgba() strings', () => {
    expect(mixColors('#f00', '#fff', 0.5)).toBe('#ff8080');
    expect(mixColors('rgb(255, 0, 0)', 'rgb(255, 255, 255)', 0.5)).toBe('#ff8080');
    expect(mixColors('rgba(255, 0, 0, 0.9)', '#ffffff', 0.5)).toBe('#ff8080');
  });

  it('falls back to the base when an input is unparseable', () => {
    expect(mixColors('var(--x)', '#ffffff', 0.2)).toBe('#ffffff');
    expect(mixColors('oklch(0.7 0.1 200)', '#202020', 0.2)).toBe('#202020');
  });

  it('clamps the ratio', () => {
    expect(mixColors('#ff0000', '#ffffff', 2)).toBe('#ff0000');
    expect(mixColors('#ff0000', '#ffffff', -1)).toBe('#ffffff');
  });

  it('treats non-finite ratios as unmixable (falls back to base)', () => {
    expect(mixColors('#ff0000', '#ffffff', NaN)).toBe('#ffffff');
    expect(mixColors('#ff0000', '#ffffff', Infinity)).toBe('#ffffff');
    expect(mixColors('#ff0000', '#ffffff', -Infinity)).toBe('#ffffff');
  });
});

describe('soft token completion (#219 retro)', () => {
  it('completeTheme computes every *-soft from softMix into base-100', () => {
    const t = completeTheme(theme({ softMix: 0.2 }));
    // 20% of #0000ff into #ffffff → #ccccff
    expect(t.colors['primary-soft']).toBe('#ccccff');
    expect(t.colors['error-soft']).toBe('#ffcccc');
    expect(t.colors['neutral-soft']).toBeDefined();
  });

  it('keeps explicitly provided softs verbatim', () => {
    const t = completeTheme(theme({
      colors: { ...CORE, 'primary-soft': '#123456' },
      softMix: 0.2,
    }));
    expect(t.colors['primary-soft']).toBe('#123456');
    expect(t.colors['secondary-soft']).not.toBe('#123456');
  });

  it('registerTheme enriches, so colorsOf serves a complete palette', () => {
    registerTheme(theme({ name: 'soft-reg-test', softMix: 0.1 }));
    const palette = colorsOf('soft-reg-test')!;
    // 10% of #0000ff into #ffffff → #e6e6ff
    expect(palette['primary-soft']).toBe('#e6e6ff');
  });

  it('extendTheme recomputes softs when a core color changes', () => {
    registerTheme(theme({ name: 'soft-ext-base', softMix: 0.2 }));
    const derived = extendTheme('soft-ext-base', {
      name: 'soft-ext-derived',
      colors: { primary: '#00ff00' },
    });
    // recomputed from the NEW primary, not the base's stale blue tint
    expect(derived.colors['primary-soft']).toBe('#ccffcc');
    // untouched variants keep their (re)computed tints
    expect(derived.colors['error-soft']).toBe('#ffcccc');
    // explicit soft in the patch wins
    const pinned = extendTheme('soft-ext-base', {
      name: 'soft-ext-pinned',
      colors: { 'primary-soft': '#aabbcc' },
    });
    expect(pinned.colors['primary-soft']).toBe('#aabbcc');
  });
});
