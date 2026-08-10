import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { extendTheme, registerTheme, themeController } from '@sigx/lynx-zero';

// `useTheme().name` rendered as text, so we can assert which controller a given
// point in the tree resolves to.
const Probe = component(() => () => <text>{useTheme().name}</text>);

describe('theme — headless control + layered overrides (#113)', () => {
  beforeEach(() => {
    // The global theme is a module singleton shared across tests — pin a known
    // starting point so order can't leak.
    themeController.set('daisy-light');
  });

  it('useTheme() never throws and resolves to the global controller when headless', () => {
    expect(() => useTheme()).not.toThrow();
    expect(useTheme()).toBe(themeController);
  });

  it('themeController.set() is reachable headlessly and updates the selection', () => {
    themeController.set('daisy-dark');
    expect(themeController.name).toBe('daisy-dark');
    expect(themeController.followingSystem).toBe(false);
  });

  it('a root <ThemeProvider> with no `initial` respects a theme set headlessly before mount', () => {
    themeController.set('daisy-dark');
    const { container } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(container.findByText('daisy-dark')).toBeTruthy();
  });

  it('a root <ThemeProvider initial> binds the global singleton', () => {
    render(
      <ThemeProvider initial="daisy-dark">
        <Probe />
      </ThemeProvider>,
    );
    // The root drives the global controller, so headless reads agree with it.
    expect(themeController.name).toBe('daisy-dark');
  });

  it('a nested <ThemeProvider> overrides its subtree without touching the global theme', () => {
    const { container } = render(
      <ThemeProvider initial="daisy-light">
        <ThemeProvider initial="daisy-synthwave">
          <Probe />
        </ThemeProvider>
      </ThemeProvider>,
    );
    // Subtree sees the override...
    expect(container.findByText('daisy-synthwave')).toBeTruthy();
    // ...while the global (what StatusBarSync / the OS bars follow) stays on root.
    expect(themeController.name).toBe('daisy-light');
  });

  it('falls back to inline palette vars + literal surface colors where CSS rules cannot reach', () => {
    // No `__SIGX_CSS_RULE__` define under Vitest — the same state as a web
    // build or `enableCSSRule: false`. The palette then rides inline and
    // descendants resolve var(--color-*) from first paint (#116).
    const { container } = render(
      <ThemeProvider initial="daisy-dark">
        <view />
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._class.split(' ')).toContain('lynx-zero');
    expect(host._class.split(' ')).toContain('daisy-dark');
    expect(host._style['--color-primary']).toBe('#7582ff');
    expect(host._style['--color-base-100']).toBe('#1d232a');
    // base-100 / base-content are additionally painted as literal properties
    // so the provider's own surface never depends on same-element var().
    expect(host._style.backgroundColor).toBe('#1d232a');
    expect(host._style.color).toBe('#a6adbb');
  });
});

describe('theme — built-ins resolve from generated CSS (#985)', () => {
  const withCss = globalThis as { __SIGX_CSS_RULE__?: boolean };

  beforeEach(() => {
    // What a real native build looks like: `@sigx/lynx-plugin` folds this to
    // true, and `scripts/gen-theme-css.mjs` has emitted `.daisy-*` rules.
    withCss.__SIGX_CSS_RULE__ = true;
    themeController.set('daisy-light');
  });

  afterEach(() => {
    delete withCss.__SIGX_CSS_RULE__;
  });

  it('sends the theme name and nothing else — the palette is the stylesheet\'s job', () => {
    const { container } = render(
      <ThemeProvider initial="daisy-dark">
        <view />
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._class.split(' ')).toContain('daisy-dark');
    expect(host._style['--color-primary']).toBeUndefined();
    expect(host._style.backgroundColor).toBeUndefined();
  });

  it('follows the OS through the engine when no theme is pinned', () => {
    themeController.followSystem();
    const { container } = render(
      <ThemeProvider>
        <view />
      </ThemeProvider>,
    );
    const classes = container.children[0]._class.split(' ');
    // daisy-light / daisy-dark are first of their variants, so they are the
    // follow-system defaults — and both ship a prefers-color-scheme rule.
    expect(classes).toContain('scheme-light-daisy-light');
    expect(classes).toContain('scheme-dark-daisy-dark');
  });

  it('keeps a runtime tenant theme on the inline path', () => {
    // The multi-tenant case: a palette fetched from a backend and derived from
    // a built-in. No `.acme-dark` rule exists, so its colors must ride inline.
    registerTheme(extendTheme('daisy-dark', {
      name: 'acme-dark',
      colors: { 'primary': '#fb7185', 'base-100': '#1a0d13' },
    }));
    const { container } = render(
      <ThemeProvider initial="acme-dark">
        <view />
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._style['--color-primary']).toBe('#fb7185');
    expect(host._style.backgroundColor).toBe('#1a0d13');
  });
});

describe('theme — global fontScale (orthogonal text scaling)', () => {
  beforeEach(() => {
    // fontScale is a module singleton too — reset alongside the theme.
    themeController.set('daisy-light');
    themeController.setFontScale(1);
  });

  it('defaults to 1 and updates via setFontScale()', () => {
    expect(themeController.fontScale).toBe(1);
    themeController.setFontScale(1.25);
    expect(themeController.fontScale).toBe(1.25);
  });

  it('persists across theme set() / toggle() — orthogonal to the theme', () => {
    themeController.setFontScale(1.5);
    themeController.set('daisy-dark');
    expect(themeController.fontScale).toBe(1.5);
    themeController.toggle();
    expect(themeController.fontScale).toBe(1.5);
  });

  it('ignores invalid scales (NaN / Infinity / non-positive) and keeps the last valid one', () => {
    themeController.setFontScale(1.25);
    for (const bad of [NaN, Infinity, -Infinity, -1, 0]) {
      themeController.setFontScale(bad);
      expect(themeController.fontScale).toBe(1.25);
    }
  });
});
