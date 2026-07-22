import { describe, it, expect, beforeEach } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { themeController } from '@sigx/lynx-zero';

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

  it('applies the theme class + inline palette vars + literal surface colors on the host view', () => {
    const { container } = render(
      <ThemeProvider initial="daisy-dark">
        <view />
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._class.split(' ')).toContain('lynx-zero');
    expect(host._class.split(' ')).toContain('daisy-dark');
    // The palette is declared inline as custom properties, resolved by
    // descendants' var(--color-*) from first paint (#116).
    expect(host._style['--color-primary']).toBe('#7582ff');
    expect(host._style['--color-base-100']).toBe('#1d232a');
    // base-100 / base-content are additionally painted as literal properties
    // so the provider's own surface never depends on same-element var().
    expect(host._style.backgroundColor).toBe('#1d232a');
    expect(host._style.color).toBe('#a6adbb');
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
