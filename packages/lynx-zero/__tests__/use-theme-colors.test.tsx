import { describe, it, expect, beforeEach } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { registerTheme, themeController } from '../src/index';
import { useThemeColors, toHexColor, withAlpha } from '../src/theme/use-theme-colors';

const CORE = {
  'primary': '#0000ff', 'primary-content': '#ffffff',
  'secondary': '#ff00ff', 'secondary-content': '#ffffff',
  'accent': '#00ffff', 'accent-content': '#000000',
  'neutral': '#444444', 'neutral-content': '#ffffff',
  'base-100': '#ffffff', 'base-200': '#f0f0f0', 'base-300': '#e0e0e0',
  'base-content': 'rgb(16, 32, 48)',
  'info': '#0088ff', 'info-content': '#000000',
  'success': '#00cc66', 'success-content': '#000000',
  'warning': '#ffaa00', 'warning-content': '#000000',
  'error': '#ff0000', 'error-content': '#ffffff',
} as const;

const Probe = component(() => {
  const colors = useThemeColors();
  return () => (
    <view
      style={{
        color: colors.colorOf('base-content'),
        '-x-placeholder-color': colors.colorOf('base-content', 0.45),
      }}
    />
  );
});

describe('useThemeColors (#225)', () => {
  beforeEach(() => {
    registerTheme({ name: 'utc-light', variant: 'light', colors: { ...CORE } });
    themeController.set('utc-light');
  });

  it('resolves the active palette to hex (rgb() normalized)', () => {
    const { container } = render(<Probe />);
    expect(container.children[0]._style.color).toBe('#102030');
  });

  it('appends alpha as a hex byte', () => {
    const { container } = render(<Probe />);
    // 0.45 * 255 ≈ 115 → 0x73
    expect(container.children[0]._style['-x-placeholder-color']).toBe('#10203073');
  });
});

describe('toHexColor / withAlpha', () => {
  it('passes hex through, converts rgb()/rgba()', () => {
    expect(toHexColor('#abcdef')).toBe('#abcdef');
    expect(toHexColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(toHexColor('rgba(255, 0, 0, 0.5)')).toBe('#ff000080');
    expect(toHexColor('oklch(0.7 0.1 200)')).toBe('oklch(0.7 0.1 200)');
  });

  it('withAlpha expands #rgb, replaces an existing alpha, clamps', () => {
    expect(withAlpha('#fff', 0.5)).toBe('#ffffff80');
    expect(withAlpha('#ff000080', 1)).toBe('#ff0000ff');
    expect(withAlpha('#ff0000', 2)).toBe('#ff0000ff');
    expect(withAlpha('#ff0000', NaN)).toBe('#ff0000');
    expect(withAlpha('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)');
  });
});
