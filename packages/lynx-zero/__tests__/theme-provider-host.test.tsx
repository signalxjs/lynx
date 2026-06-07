import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { registerTheme, themeController, ThemeProvider } from '../src/index';

const CORE = {
  'primary': '#0000ff', 'primary-content': '#ffffff',
  'secondary': '#ff00ff', 'secondary-content': '#ffffff',
  'accent': '#00ffff', 'accent-content': '#000000',
  'neutral': '#444444', 'neutral-content': '#ffffff',
  'base-100': '#ffffff', 'base-200': '#f0f0f0', 'base-300': '#e0e0e0',
  'base-content': '#102030',
  'info': '#0088ff', 'info-content': '#000000',
  'success': '#00cc66', 'success-content': '#000000',
  'warning': '#ffaa00', 'warning-content': '#000000',
  'error': '#ff0000', 'error-content': '#ffffff',
} as const;

describe('ThemeProvider host layout (#269)', () => {
  beforeEach(() => {
    registerTheme({ name: 'tph-light', variant: 'light', colors: { ...CORE } });
    registerTheme({ name: 'tph-alt', variant: 'light', colors: { ...CORE } });
    themeController.set('tph-light');
  });

  it('root provider defaults to flex-fill long-form', () => {
    const { container } = render(
      <ThemeProvider initial="tph-light">
        <text>root</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._style.flexGrow).toBe(1);
    expect(host._style.flexShrink).toBe(1);
    expect(host._style.flexBasis).toBe(0);
    expect(host._style.minHeight).toBe(0);
    expect(host._style.flexDirection).toBe('column');
  });

  it('nested provider sizes to content — no flex-fill collapse inside scroll content', () => {
    const { container } = render(
      <ThemeProvider initial="tph-light">
        <ThemeProvider initial="tph-alt">
          <text>island</text>
        </ThemeProvider>
      </ThemeProvider>,
    );
    const nested = container.children[0].children[0];
    // `flexBasis: 0` on a scroll-view child computes to height 0 (#269) —
    // the nested sub-scope must not carry the root's flex-fill defaults.
    expect(nested._style.flexBasis).toBeUndefined();
    expect(nested._style.flexGrow).toBeUndefined();
    expect(nested._style.flexDirection).toBe('column');
    // Still themed: nested host paints its own palette surface.
    expect(nested._style.backgroundColor).toBe('#ffffff');
  });

  it('consumer style still overrides the nested defaults', () => {
    const { container } = render(
      <ThemeProvider initial="tph-light">
        <ThemeProvider initial="tph-alt" style={{ flexGrow: 1, borderRadius: 14 }}>
          <text>island</text>
        </ThemeProvider>
      </ThemeProvider>,
    );
    const nested = container.children[0].children[0];
    expect(nested._style.flexGrow).toBe(1);
    expect(nested._style.borderRadius).toBe(14);
  });
});

describe('ThemeProvider runtime setProperty guard (web compat)', () => {
  beforeEach(() => {
    registerTheme({ name: 'tpg-light', variant: 'light', colors: { ...CORE } });
    themeController.set('tpg-light');
  });

  afterEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
  });

  // `@lynx-js/web-core` resolves an element with no runtime `setProperty`. The
  // provider's theme-var publish runs on the background thread, so an unguarded
  // call would throw there and abort the whole card render. It must degrade.
  it('mounts without throwing when the host element lacks setProperty (e.g. web)', () => {
    let calls = 0;
    (globalThis as { lynx?: unknown }).lynx = {
      getElementById: () => {
        calls++;
        return {};
      },
    };
    expect(() =>
      render(
        <ThemeProvider initial="tpg-light">
          <text>x</text>
        </ThemeProvider>,
      ),
    ).not.toThrow();
    // The guarded publish path must actually run (else the test is vacuous).
    expect(calls).toBeGreaterThan(0);
  });

  it('swallows a throwing setProperty without aborting render', () => {
    let calls = 0;
    (globalThis as { lynx?: unknown }).lynx = {
      getElementById: () => ({
        setProperty: () => {
          calls++;
          throw new Error('setProperty unsupported on this host');
        },
      }),
    };
    expect(() =>
      render(
        <ThemeProvider initial="tpg-light">
          <text>x</text>
        </ThemeProvider>,
      ),
    ).not.toThrow();
    expect(calls).toBeGreaterThan(0);
  });
});
