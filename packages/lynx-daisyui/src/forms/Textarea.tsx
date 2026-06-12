import { component, type Define, type Model } from '@sigx/lynx';
import { useThemeColors, type ColorVariant } from '@sigx/lynx-zero';

export type TextareaSize = 'xs' | 'sm' | 'md' | 'lg';
export type TextareaVariant = 'bordered' | 'ghost';
export type TextareaColor = Exclude<ColorVariant, 'neutral'>;

export type TextareaProps =
  & Define.Prop<'placeholder', string, false>
  & Define.Prop<'rows', number, false>
  & Define.Prop<'size', TextareaSize, false>
  & Define.Prop<'variant', TextareaVariant, false>
  & Define.Prop<'color', TextareaColor, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Model<string>;

const sizeClasses: Record<TextareaSize, string> = {
  xs: 'textarea-xs', sm: 'textarea-sm', md: '', lg: 'textarea-lg',
};

export const Textarea = component<TextareaProps>(({ props }) => {
  const colors = useThemeColors();

  const getClasses = () => {
    const c = ['textarea'];
    if (props.variant === 'bordered') c.push('textarea-bordered');
    if (props.variant === 'ghost') c.push('textarea-ghost');
    if (props.color) c.push(`textarea-${props.color}`);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  const getHeight = () => {
    const rows = props.rows ?? 3;
    const lineHeight = 20;
    const padding = 16;
    return rows * lineHeight + padding;
  };

  // Height plus the native-widget theme colors (#225): every themed color
  // (background, border, text, placeholder) is resolved from the active scoped
  // palette to literal hex — native text widgets can't read CSS custom
  // properties. Reactive via useThemeColors, so a theme switch recolors the
  // field immediately instead of only after a remount (the .textarea class's
  // var()-based colors never repaint a live native textarea).
  const getStyle = () => {
    const style: Record<string, string | number> = {
      height: getHeight(),
      backgroundColor: props.variant === 'ghost' ? 'transparent' : colors.colorOf('base-100'),
      color: colors.colorOf('base-content'),
      '-x-placeholder-color': colors.colorOf('base-content', 0.45),
    };
    if (props.color) style.borderColor = colors.colorOf(props.color);
    else if (props.variant === 'bordered') style.borderColor = colors.colorOf('base-300');
    return style;
  };

  return () => (
    <textarea
      class={getClasses()}
      placeholder={props.placeholder}
      disabled={props.disabled}
      model={props.model}
      style={getStyle()}
    />
  );
});
