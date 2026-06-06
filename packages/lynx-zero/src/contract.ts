/**
 * The shared design-system contract.
 *
 * `@sigx/lynx-zero` is the design-system-neutral foundation that DS packages
 * (`@sigx/lynx-daisyui`, `@sigx/lynx-heroui`, …) build on. This module is the
 * *vocabulary* they agree on — size scales, semantic colors, theme token
 * names, and common prop shapes — so that switching an app from one design
 * system to another is mostly an import swap, not a rewrite.
 *
 * Rules of the contract:
 *
 * - DS packages **extend** these types, they never redeclare them. A daisy
 *   button is `color: ColorVariant` plus daisy-specific extras; its size IS
 *   `SizeScale`. Drift fails `pnpm typecheck`.
 * - `variant` is intentionally NOT in the contract — fill style (outline,
 *   soft, bordered, flat, …) is design-system chrome and differs per DS.
 * - Theme CSS custom-property NAMES are part of the contract (see below);
 *   the *values* come from each DS's registered themes.
 *
 * ## Structural token-name contract
 *
 * Every DS theme resolves against the same custom-property names:
 *
 * - Colors:    `--color-<ColorToken>` (e.g. `--color-primary`, `--color-base-100`)
 * - Roundness: `--radius-selector` | `--radius-field` | `--radius-box`
 * - Sizing:    `--size-selector` | `--size-field`, `--size-xs` … `--size-lg`
 * - Text ramp: `--text-xs` … `--text-3xl` (app text, font-scaled)
 * - Controls:  `--font-xs` … `--font-lg` (control-internal labels, unscaled)
 * - Misc:      `--disabled-opacity`
 */
import type { Define } from '@sigx/lynx';

/** The shared component size scale. */
export type SizeScale = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Semantic color names — the shared `color` prop vocabulary. A DS maps each
 * onto its palette (HeroUI: `danger`→`error`, `default`→`neutral`, …).
 */
export type ColorVariant =
  | 'primary' | 'secondary' | 'accent' | 'neutral'
  | 'info' | 'success' | 'warning' | 'error';

/**
 * The full set of semantic color tokens every theme defines, exposed as
 * `--color-<token>` CSS custom properties.
 *
 * Single source of truth: the `ColorToken` union and the runtime
 * `COLOR_TOKENS` Set both derive from this tuple.
 */
const COLOR_TOKEN_LIST = [
  'primary', 'primary-content',
  'secondary', 'secondary-content',
  'accent', 'accent-content',
  'neutral', 'neutral-content',
  'base-100', 'base-200', 'base-300', 'base-content',
  'info', 'info-content',
  'success', 'success-content',
  'warning', 'warning-content',
  'error', 'error-content',
] as const;

export type ColorToken = typeof COLOR_TOKEN_LIST[number];

// Compile-time guard: every ColorVariant must be a ColorToken.
type _VariantIsToken = ColorVariant extends ColorToken ? true : never;
const _variantIsToken: _VariantIsToken = true;
void _variantIsToken;

const COLOR_TOKENS: ReadonlySet<ColorToken> = new Set(COLOR_TOKEN_LIST);

/**
 * Resolve a color value to a CSS color string.
 *
 * - Known semantic tokens (e.g. `'base-100'`) → `var(--color-base-100)`.
 * - Anything else (`'#ffaa00'`, `'rgb(…)'`, `'var(--my-custom)'`) passes
 *   through unchanged.
 */
export function resolveColorToken(value: string): string {
  return (COLOR_TOKENS as ReadonlySet<string>).has(value)
    ? `var(--color-${value})`
    : value;
}

/**
 * Accepts a semantic color token (autocompleted) OR any raw CSS color
 * string (`'#fff'`, `'rgb(…)'`, `'var(--foo)'`).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types
export type BackgroundValue = ColorToken | (string & {});

// ---------------------------------------------------------------------------
// Common prop fragments — DS component props intersect these instead of
// redeclaring the conventions.
// ---------------------------------------------------------------------------

/** Arbitrary extra classes appended after the DS-computed ones. */
export type WithClass = Define.Prop<'class', string, false>;

/** Disabled: non-interactive + DS disabled styling. */
export type WithDisabled = Define.Prop<'disabled', boolean, false>;

/** Semantic color of the component (`primary`, `error`, …). */
export type WithColor = Define.Prop<'color', ColorVariant, false>;

/** Component size on the shared scale. */
export type WithSize = Define.Prop<'size', SizeScale, false>;

/** The shared press event — sigx convention is `onPress`, not `onTap`/`onClick`. */
export type PressEvent = Define.Event<'press', void>;
