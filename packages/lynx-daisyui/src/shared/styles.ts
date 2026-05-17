export type SpacingValue = number | {
  x?: number;
  y?: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export interface BoxProps {
  width?: number | string;
  height?: number | string;
  flex?: number;
  background?: string;
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
  if (props.background !== undefined) style.backgroundColor = props.background;
  if (props.borderRadius !== undefined) style.borderRadius = props.borderRadius;

  Object.assign(style, resolveSpacing(props.padding, 'padding'));
  Object.assign(style, resolveSpacing(props.margin, 'margin'));

  return style;
}
