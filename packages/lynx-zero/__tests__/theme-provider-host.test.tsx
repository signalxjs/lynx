import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
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

describe('ThemeProvider inline theme vars (#116) — the no-stylesheet path', () => {
  beforeEach(() => {
    registerTheme({ name: 'tpv-light', variant: 'light', colors: { ...CORE } });
    registerTheme({
      name: 'tpv-dark', variant: 'dark', pair: 'tpv-light',
      colors: { ...CORE, 'primary': '#8899ff', 'base-100': '#111111', 'base-content': '#eeeeee' },
    });
    themeController.set('tpv-light');
  });

  it('declares the full palette inline on the host at first render', () => {
    const { container } = render(
      <ThemeProvider initial="tpv-light">
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._style['--color-primary']).toBe('#0000ff');
    expect(host._style['--color-base-100']).toBe('#ffffff');
    // Computed soft tints are materialized into the palette too.
    expect(host._style['--color-primary-soft']).toBeDefined();
    // At fontScale 1 the ramp is NOT emitted: `.lynx-zero` already declares
    // exactly these literals, and a class declaration on the element beats
    // anything inherited from an enclosing scaled provider (#985).
    expect(host._style['--text-base']).toBeUndefined();
    // Host carries the theme name as a class for shape modifiers.
    expect(host._class).toContain('tpv-light');
  });

  it('a theme switch swaps the inline vars', async () => {
    const { container } = render(
      <ThemeProvider initial="tpv-light">
        <text>x</text>
      </ThemeProvider>,
    );
    await act(() => themeController.set('tpv-dark'));
    const host = container.children[0];
    expect(host._style['--color-primary']).toBe('#8899ff');
    expect(host._style['--color-base-100']).toBe('#111111');
    expect(host._style.backgroundColor).toBe('#111111');
    expect(host._class).toContain('tpv-dark');
  });

  it('a runtime-registered theme paints its exact palette on the first frame', () => {
    registerTheme({
      name: 'tpv-tenant', variant: 'light',
      colors: { ...CORE, 'primary': '#123456' },
    });
    const { container } = render(
      <ThemeProvider initial="tpv-tenant">
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    // No built-in-class fallback: the host wears its own name and exact vars.
    expect(host._class).toContain('tpv-tenant');
    expect(host._style['--color-primary']).toBe('#123456');
  });

  it('fontScale scales the --text-* ramp', () => {
    const { container } = render(
      <ThemeProvider initial="tpv-light" fontScale={2}>
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._style['--text-base']).toBe('34px');
    expect(host._style['--text-xs']).toBe('24px');
  });
});

/**
 * The CSS-first path (#985). `__SIGX_CSS_RULE__` is the build define that says
 * stylesheet at-rules reach this bundle's binary; `@sigx/lynx-plugin` folds it
 * to a literal, and it is absent under Vitest — which is exactly why every
 * suite above exercises the inline fallback. Here we turn it on to assert the
 * other branch.
 */
describe('ThemeProvider CSS-backed themes (#985)', () => {
  const withCss = globalThis as { __SIGX_CSS_RULE__?: boolean };

  beforeEach(() => {
    withCss.__SIGX_CSS_RULE__ = true;
    // A design system's built-ins: palette data AND a generated stylesheet.
    registerTheme({
      name: 'cf-light', variant: 'light', pair: 'cf-dark',
      staticCss: true, colors: { ...CORE },
    });
    registerTheme({
      name: 'cf-dark', variant: 'dark', pair: 'cf-light', staticCss: true,
      colors: { ...CORE, 'base-100': '#111111', 'base-content': '#eeeeee' },
    });
    // A tenant palette fetched at runtime: data only, no CSS to resolve.
    registerTheme({
      name: 'cf-tenant', variant: 'light', pair: 'cf-dark',
      colors: { ...CORE, 'primary': '#abcdef' },
    });
    themeController.set('cf-light');
  });

  afterEach(() => {
    delete withCss.__SIGX_CSS_RULE__;
  });

  it('a pinned CSS-backed theme puts nothing but its name on the host', () => {
    const { container } = render(
      <ThemeProvider initial="cf-light">
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._class).toContain('cf-light');
    // The palette is the stylesheet's job now — none of it rides in the op.
    expect(host._style['--color-primary']).toBeUndefined();
    expect(host._style['--color-base-100']).toBeUndefined();
    // Including the surface paints, which the generated rule also carries.
    expect(host._style.backgroundColor).toBeUndefined();
    expect(host._style.color).toBeUndefined();
    // Layout still comes from the provider.
    expect(host._style.flexGrow).toBe(1);
    // Pinned means pinned: no scheme classes, the engine gets no say.
    expect(host._class).not.toContain('scheme-light-');
    expect(host._class).not.toContain('scheme-dark-');
  });

  it('following the system hands the scheme choice to the engine', () => {
    themeController.followSystem();
    const { container } = render(
      <ThemeProvider light="cf-light" dark="cf-dark">
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    // Both branches are on the host; the `@media` rules pick exactly one, so a
    // stale JS scheme can no longer paint the wrong palette.
    expect(host._class).toContain('scheme-light-cf-light');
    expect(host._class).toContain('scheme-dark-cf-dark');
    expect(host._style['--color-primary']).toBeUndefined();
  });

  it('a runtime-registered tenant theme still paints its exact palette inline', () => {
    const { container } = render(
      <ThemeProvider initial="cf-tenant">
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    // No generated rule exists for it, so the inline transport is the only way
    // its colors can land — define or no define.
    expect(host._style['--color-primary']).toBe('#abcdef');
    expect(host._style.backgroundColor).toBe('#ffffff');
    expect(host._class).toContain('cf-tenant');
  });

  it('a tenant light/dark pair keeps the whole scope on the JS path', () => {
    registerTheme({
      name: 'cf-tenant-dark', variant: 'dark', pair: 'cf-tenant',
      colors: { ...CORE, 'base-100': '#221111' },
    });
    themeController.followSystem();
    const { container } = render(
      <ThemeProvider light="cf-tenant" dark="cf-tenant-dark">
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._class).not.toContain('scheme-light-');
    expect(host._style['--color-primary']).toBe('#abcdef');
  });

  it('declines the engine when a pair member answers for the wrong scheme', () => {
    themeController.followSystem();
    const { container } = render(
      // `dark` pointing at a light-variant theme: no dark-scheme rule was ever
      // generated for it, so the media branch would leave the app unstyled.
      <ThemeProvider light="cf-light" dark="cf-light">
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    // No media branch — but the resolved theme is still CSS-backed, so it
    // falls back to its PINNED rule (name class), not to the inline path.
    expect(host._class).not.toContain('scheme-dark-');
    expect(host._class).not.toContain('scheme-light-');
    expect(host._class).toContain('cf-light');
    expect(host._style['--color-primary']).toBeUndefined();
  });

  it('declines the engine for a multi-class theme composition', () => {
    themeController.followSystem();
    const { container } = render(
      <ThemeProvider light="cf-light cf-rounded" dark="cf-dark">
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    // `scheme-light-cf-light cf-rounded` is not a class name.
    expect(host._class).not.toContain('scheme-light-');
    expect(host._class).toContain('cf-rounded');
  });

  it('still emits the scaled text ramp — fontScale is runtime state, not CSS', () => {
    const { container } = render(
      <ThemeProvider initial="cf-light" fontScale={2}>
        <text>x</text>
      </ThemeProvider>,
    );
    const host = container.children[0];
    expect(host._style['--text-base']).toBe('34px');
    expect(host._style['--color-primary']).toBeUndefined();
  });

  it('switching tenant → built-in leaves no stale palette in the style op', async () => {
    const { container } = render(
      <ThemeProvider initial="cf-tenant">
        <text>x</text>
      </ThemeProvider>,
    );
    expect(container.children[0]._style['--color-primary']).toBe('#abcdef');
    await act(() => themeController.set('cf-light'));
    const host = container.children[0];
    // The style object is rebuilt per render, so the tenant's vars are simply
    // absent from the next op — nothing left to override the CSS rule.
    expect(host._style['--color-primary']).toBeUndefined();
    expect(host._class).toContain('cf-light');
  });
});
