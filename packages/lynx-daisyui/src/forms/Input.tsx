import { component, type Define, type Model } from '@sigx/lynx';
import { useThemeColors, type ColorVariant } from '@sigx/lynx-zero';

export type InputSize = 'xs' | 'sm' | 'md' | 'lg';
export type InputVariant = 'bordered' | 'ghost';
export type InputColor = Exclude<ColorVariant, 'neutral'>;

export type InputProps =
  & Define.Prop<'placeholder', string, false>
  & Define.Prop<'size', InputSize, false>
  & Define.Prop<'variant', InputVariant, false>
  & Define.Prop<'color', InputColor, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'type', 'text' | 'number' | 'password', false>
  & Define.Prop<'class', string, false>
  & Define.Model<string>;

const sizeClasses: Record<InputSize, string> = {
  xs: 'input-xs', sm: 'input-sm', md: '', lg: 'input-lg',
};

export const Input = component<InputProps>(({ props }) => {
  const colors = useThemeColors();

  const getClasses = () => {
    const c = ['input'];
    if (props.variant === 'bordered') c.push('input-bordered');
    if (props.variant === 'ghost') c.push('input-ghost');
    if (props.color) c.push(`input-${props.color}`);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  // Native text widgets can't read CSS custom properties (#225) — every themed
  // color (background, border, text, placeholder) is resolved from the active
  // scoped palette to literal hex and applied inline. Reactive: reads
  // theme.name via useThemeColors, so a theme switch recolors the field
  // immediately instead of only after a remount (the .input class's
  // var()-based colors never repaint a live native input).
  const getStyle = () => {
    const style: Record<string, string> = {
      backgroundColor: props.variant === 'ghost' ? 'transparent' : colors.colorOf('base-100'),
      color: colors.colorOf('base-content'),
      '-x-placeholder-color': colors.colorOf('base-content', 0.45),
    };
    if (props.color) style.borderColor = colors.colorOf(props.color);
    else if (props.variant === 'bordered') style.borderColor = colors.colorOf('base-300');
    return style;
  };

  return () => (
    <input
      class={getClasses()}
      style={getStyle()}
      placeholder={props.placeholder}
      type={props.type ?? 'text'}
      disabled={props.disabled}
      model={props.model}
    />
  );
});
