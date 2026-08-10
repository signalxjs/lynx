/**
 * `staticCss` — the registry flag that says a theme's palette ALSO ships as a
 * generated stylesheet rule, so `<ThemeProvider>` can let the CSS engine
 * resolve it instead of declaring it inline (#985).
 *
 * The load-bearing case is the negative one: a theme that claims `staticCss`
 * without shipping CSS has no rule to resolve against and no inline palette
 * either — an app with no colors at all. That is one `extendTheme()` away for
 * anyone deriving a tenant theme from a built-in, which is why it is pinned
 * here.
 */
import { describe, it, expect } from 'vitest';
import {
  extendTheme,
  hasStaticCss,
  registerTheme,
  type ThemePaletteInput,
} from '../src/theme/registry';

const CORE: ThemePaletteInput = {
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
};

describe('staticCss (#985)', () => {
  it('reports the flag for a design system built-in', () => {
    registerTheme({
      name: 'sc-builtin', variant: 'light', staticCss: true, colors: { ...CORE },
    });
    expect(hasStaticCss('sc-builtin')).toBe(true);
  });

  it('is false for a runtime-registered theme and for unknown names', () => {
    registerTheme({ name: 'sc-tenant', variant: 'light', colors: { ...CORE } });
    expect(hasStaticCss('sc-tenant')).toBe(false);
    expect(hasStaticCss('sc-never-registered')).toBe(false);
    expect(hasStaticCss(undefined)).toBe(false);
  });

  it('does NOT ride along through extendTheme', () => {
    registerTheme({
      name: 'sc-base', variant: 'light', staticCss: true, colors: { ...CORE },
    });
    // The multi-tenant case: a backend palette derived from a built-in. It is a
    // new name, so no `.sc-derived` rule was ever generated for it — inheriting
    // the flag would make the provider skip the inline palette and resolve
    // against nothing.
    const derived = extendTheme('sc-base', {
      name: 'sc-derived',
      colors: { primary: '#abcdef' },
    });
    expect(derived.staticCss).toBeUndefined();
    registerTheme(derived);
    expect(hasStaticCss('sc-derived')).toBe(false);
  });

  it('resolves through a multi-class composition, like the other lookups', () => {
    registerTheme({
      name: 'sc-multi', variant: 'light', staticCss: true, colors: { ...CORE },
    });
    expect(hasStaticCss('sc-multi sc-rounded')).toBe(true);
  });
});
