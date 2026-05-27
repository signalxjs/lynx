import { describe, it, expect, beforeEach } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { themeController } from '../src/theme/theme-state';

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

  it('applies the active palette as inline CSS custom properties on the host view', () => {
    const { container } = render(
      <ThemeProvider initial="daisy-dark">
        <view />
      </ThemeProvider>,
    );
    const host = container.children[0];
    // daisy-dark base-100 / primary, painted literally (Lynx can't resolve var() inline).
    expect(host._style.backgroundColor).toBe('#1d232a');
    expect(host._style['--color-primary']).toBe('#7582ff');
  });
});
