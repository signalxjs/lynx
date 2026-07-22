/**
 * The two built-in hero themes — HeroUI's default light/dark palettes mapped
 * onto the shared `ColorToken` contract and registered into
 * `@sigx/lynx-zero`'s theme registry at module load.
 *
 * Token mapping from upstream HeroUI semantics (the pilot's validation of the
 * contract — see signalxjs/lynx#219):
 *
 *   danger          → error
 *   default         → neutral
 *   background      → base-100
 *   content2/3      → base-200 / base-300
 *   foreground      → base-content
 *   accent / info   → no upstream equivalent; hero ships its cyan + blue-400
 *
 * `<ThemeProvider>` declares the active palette as inline CSS custom
 * properties on its host view — correct on first paint for built-ins and
 * runtime-registered themes alike (#116) — so no per-theme CSS ships here.
 *
 * HeroUI's default roundness is larger than daisy's — expressed via the
 * theme-level `radius` overrides (the engine emits them with the palette).
 */
import { completeTheme, registerTheme, type Theme, type ThemeInput } from '@sigx/lynx-zero/registry';

/**
 * Theme class applied to the provider's host view. The two built-ins get
 * autocomplete; arbitrary strings are accepted for custom registered themes.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types
export type HeroTheme = 'hero-light' | 'hero-dark' | (string & {});

/** The built-in theme data. @internal */
const RAW_THEMES: readonly ThemeInput[] = [
  {
    name: 'hero-light', variant: 'light', pair: 'hero-dark', softMix: 0.2,
    radius: { selector: '12px', field: '12px', box: '14px' },
    colors: {
      'primary': '#006fee', 'primary-content': '#ffffff',
      'secondary': '#7828c8', 'secondary-content': '#ffffff',
      'accent': '#06b7db', 'accent-content': '#000000',
      'neutral': '#d4d4d8', 'neutral-content': '#11181c',
      'base-100': '#ffffff', 'base-200': '#f4f4f5', 'base-300': '#e4e4e7',
      'base-content': '#11181c',
      'info': '#338ef7', 'info-content': '#000000',
      'success': '#17c964', 'success-content': '#000000',
      'warning': '#f5a524', 'warning-content': '#000000',
      'error': '#f31260', 'error-content': '#ffffff',
    },
  },
  {
    name: 'hero-dark', variant: 'dark', pair: 'hero-light', softMix: 0.2,
    radius: { selector: '12px', field: '12px', box: '14px' },
    colors: {
      'primary': '#006fee', 'primary-content': '#ffffff',
      'secondary': '#9353d3', 'secondary-content': '#ffffff',
      'accent': '#06b7db', 'accent-content': '#000000',
      'neutral': '#3f3f46', 'neutral-content': '#ecedee',
      'base-100': '#000000', 'base-200': '#18181b', 'base-300': '#27272a',
      'base-content': '#ecedee',
      'info': '#338ef7', 'info-content': '#000000',
      'success': '#17c964', 'success-content': '#000000',
      'warning': '#f5a524', 'warning-content': '#000000',
      'error': '#f31260', 'error-content': '#ffffff',
    },
  },
];

// Seed at module load. hero-light / hero-dark are first of their variants, so
// they are the follow-system defaults when hero is the app's design system.
export const HERO_BUILTIN_THEMES: readonly Theme[] = RAW_THEMES.map(completeTheme);

for (const theme of HERO_BUILTIN_THEMES) registerTheme(theme);
