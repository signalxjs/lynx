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
 *
 * Single source of truth: the `ColorVariant` union, the `-content` / `-soft`
 * token derivations, and the runtime `COLOR_TOKENS` Set all derive from this
 * tuple.
 */
export const COLOR_VARIANT_LIST = [
  'primary', 'secondary', 'accent', 'neutral',
  'info', 'success', 'warning', 'error',
] as const;

export type ColorVariant = typeof COLOR_VARIANT_LIST[number];

/**
 * Tokens authored by every theme: each variant + its `-content` pairing,
 * plus the base surfaces.
 */
export type CoreColorToken =
  | ColorVariant
  | `${ColorVariant}-content`
  | 'base-100' | 'base-200' | 'base-300' | 'base-content';

/**
 * Soft (tinted-surface) tokens — one per variant, emitted as
 * `--color-<variant>-soft`. Lynx CSS can't alpha-compose `var()` colors, so
 * these are *materialized in the palette*: computed at theme registration
 * (`Theme.softMix` of the variant color mixed into `base-100`) unless the
 * theme provides them explicitly. They are what soft/flat component fills
 * read (`btn-soft`, hero's `flat`).
 */
export type SoftColorToken = `${ColorVariant}-soft`;

/**
 * The full set of semantic color tokens every *registered* theme carries,
 * exposed as `--color-<token>` CSS custom properties. Authors write the core
 * tokens; the registry completes the soft ones.
 */
export type ColorToken = CoreColorToken | SoftColorToken;

const COLOR_TOKEN_LIST: readonly ColorToken[] = [
  ...COLOR_VARIANT_LIST.flatMap((v): ColorToken[] => [v, `${v}-content`, `${v}-soft`]),
  'base-100', 'base-200', 'base-300', 'base-content',
];

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

/**
 * Accessibility passthrough for interactive components — mirrors the
 * `accessibility-*` surface `@sigx/lynx-gestures`'s `Pressable` accepts on
 * its host view (the same node that owns the gesture handler, so
 * screen-reader activation works). DS components intersect this and forward
 * the props verbatim.
 */
export type WithAccessibility =
  & Define.Prop<'accessibility-element', boolean, false>
  & Define.Prop<'accessibility-label', string, false>
  & Define.Prop<'accessibility-role', string, false>
  & Define.Prop<'accessibility-trait', string, false>
  & Define.Prop<'accessibility-status', string, false>;
