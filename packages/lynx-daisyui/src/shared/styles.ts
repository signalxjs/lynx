/**
 * DaisyUI color tokens — the set of semantic colors exposed by the
 * built-in themes (`daisy-light` / `daisy-dark`) as `--color-<token>`
 * CSS custom properties.
 *
 * Used by layout components' `background` prop so consumers can write
 * `<Col background="base-100">` instead of `<Col class="bg-base-100">`
 * and still get autocomplete + type safety.
 *
 * Single source of truth: both the `DaisyColor` union and the runtime
 * `DAISY_COLOR_TOKENS` Set are derived from this tuple, so adding /
 * removing a token in one place is impossible.
 */
const DAISY_COLOR_TOKEN_LIST = [
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

export type DaisyColor = typeof DAISY_COLOR_TOKEN_LIST[number];

const DAISY_COLOR_TOKENS: ReadonlySet<DaisyColor> = new Set(DAISY_COLOR_TOKEN_LIST);

/**
 * Resolve a `background` prop value to a CSS color string.
 *
 * - Known daisyUI tokens (e.g. `'base-100'`) → `var(--color-base-100)`.
 * - Anything else (`'#ffaa00'`, `'rgb(…)'`, `'var(--my-custom)'`) is passed through unchanged.
 */
export function resolveDaisyColor(value: string): string {
  return (DAISY_COLOR_TOKENS as ReadonlySet<string>).has(value)
    ? `var(--color-${value})`
    : value;
}

export type SpacingValue = number | {
  x?: number;
  y?: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

/**
 * Accepts a daisyUI color token (autocompleted) OR any raw CSS color
 * string (`'#fff'`, `'rgb(…)'`, `'var(--foo)'`).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types
export type BackgroundValue = DaisyColor | (string & {});

export interface BoxProps {
  width?: number | string;
  height?: number | string;
  flex?: number;
  background?: BackgroundValue;
  borderRadius?: number;
  padding?: SpacingValue;
  margin?: SpacingValue;
}

export function resolveSpacing(
  value: SpacingValue | undefined,
  prefix: 'padding' | 'margin'
): Record<string, number> {
  if (value === undefined) return {};

  if (typeof value === 'number') {
    return {
      [`${prefix}Top`]: value,
      [`${prefix}Right`]: value,
      [`${prefix}Bottom`]: value,
      [`${prefix}Left`]: value,
    };
  }

  const style: Record<string, number> = {};

  if (value.top !== undefined) style[`${prefix}Top`] = value.top;
  else if (value.y !== undefined) style[`${prefix}Top`] = value.y;

  if (value.bottom !== undefined) style[`${prefix}Bottom`] = value.bottom;
  else if (value.y !== undefined) style[`${prefix}Bottom`] = value.y;

  if (value.right !== undefined) style[`${prefix}Right`] = value.right;
  else if (value.x !== undefined) style[`${prefix}Right`] = value.x;

  if (value.left !== undefined) style[`${prefix}Left`] = value.left;
  else if (value.x !== undefined) style[`${prefix}Left`] = value.x;

  return style;
}

export function resolveBoxStyle(props: BoxProps): Record<string, unknown> {
  const style: Record<string, unknown> = {};

  if (props.width !== undefined) style.width = props.width;
  if (props.height !== undefined) style.height = props.height;
  if (props.flex !== undefined) {
    // Lynx (like React Native) expands `flex: n` shorthand to
    // `flex: n n auto`, where `flexBasis: 'auto'` means "size to content
    // first" — which collapses the layout chain. Write the long-form so
    // `<Center flex={1}>` etc. actually fill remaining space.
    style.flexGrow = props.flex;
    style.flexShrink = 1;
    style.flexBasis = 0;
    style.minHeight = 0;
  }
  if (props.background !== undefined) style.backgroundColor = resolveDaisyColor(props.background);
  if (props.borderRadius !== undefined) style.borderRadius = props.borderRadius;

  Object.assign(style, resolveSpacing(props.padding, 'padding'));
  Object.assign(style, resolveSpacing(props.margin, 'margin'));

  return style;
}
