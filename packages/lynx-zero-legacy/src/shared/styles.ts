/**
 * Box-model style helpers shared by layout primitives and design-system
 * components. Color values resolve through the semantic token contract
 * (`resolveColorToken`), so `<Col background="base-100">` works identically
 * under every design system's active theme.
 */
import type { WidthClass } from '@sigx/lynx';
import { resolveColorToken, type BackgroundValue } from '../contract.js';
import { resolveResponsive, type Responsive } from './responsive.js';

export type SpacingValue = number | {
  x?: number;
  y?: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

/**
 * Every field accepts either a plain value or a per-breakpoint object (#1013);
 * `resolveBoxStyle` collapses them against the caller's active width class.
 */
export interface BoxProps {
  width?: Responsive<number | string>;
  height?: Responsive<number | string>;
  flex?: Responsive<number>;
  background?: Responsive<BackgroundValue>;
  borderRadius?: Responsive<number>;
  padding?: Responsive<SpacingValue>;
  margin?: Responsive<SpacingValue>;
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

/**
 * Collapse box-model props to a flat inline style.
 *
 * `cls` is the active width class (from `useWidthClass()`); it is what any
 * per-breakpoint prop object resolves against. It defaults to `'compact'` so
 * existing non-responsive callers — and off-device tests — behave exactly as
 * before: with plain values the class is never consulted.
 */
export function resolveBoxStyle(
  rawProps: BoxProps,
  cls: WidthClass = 'compact',
): Record<string, unknown> {
  const props = {
    width: resolveResponsive(rawProps.width, cls),
    height: resolveResponsive(rawProps.height, cls),
    flex: resolveResponsive(rawProps.flex, cls),
    background: resolveResponsive(rawProps.background, cls),
    borderRadius: resolveResponsive(rawProps.borderRadius, cls),
    padding: resolveResponsive(rawProps.padding, cls),
    margin: resolveResponsive(rawProps.margin, cls),
  };
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
  if (props.background !== undefined) style.backgroundColor = resolveColorToken(props.background);
  if (props.borderRadius !== undefined) style.borderRadius = props.borderRadius;

  Object.assign(style, resolveSpacing(props.padding, 'padding'));
  Object.assign(style, resolveSpacing(props.margin, 'margin'));

  return style;
}
