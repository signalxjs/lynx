import { component, type Define } from '@sigx/lynx';
import { useThemeColors, type ColorVariant, type SizeScale } from '@sigx/lynx-zero';

export type TextareaSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;
/** Upstream HeroUI textarea variants — flat (filled surface) is the default. */
export type TextareaVariant = 'flat' | 'bordered';
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
  sm: 'hero-textarea-sm', md: '', lg: 'hero-textarea-lg',
};

export const Textarea = component<TextareaProps>(({ props }) => {
  const colors = useThemeColors();

  const getClasses = () => {
    const c = ['hero-textarea'];
    if (props.variant === 'bordered') c.push('hero-textarea-bordered');
    if (props.color) c.push(`hero-textarea-${props.color}`);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  // Vertical padding matches textarea.css per size (sm 8 / md 10 / lg 12, top+bottom)
  // so the computed height lines up with the rendered padding.
  const verticalPadding: Record<TextareaSize, number> = { sm: 16, md: 20, lg: 24 };

  const getHeight = () => {
    const rows = props.rows ?? 3;
    const lineHeight = 20;
    return rows * lineHeight + verticalPadding[props.size ?? 'md'];
  };

  return () => (
    <textarea
      class={getClasses()}
      placeholder={props.placeholder}
      disabled={props.disabled}
      model={props.model}
      // Height plus the native-widget theme colors (#225): typed text and
      // placeholder get literal hex from the active scoped palette — native
      // text widgets can't read CSS custom properties.
      style={{
        height: getHeight(),
        color: colors.colorOf('base-content'),
        '-x-placeholder-color': colors.colorOf('base-content', 0.45),
      }}
    />
  );
});
