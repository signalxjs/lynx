import { component, type Define, type Model } from '@sigx/lynx';
import { useThemeColors, type ColorVariant } from '@sigx/lynx-zero-legacy';

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
  // color is resolved from the active scoped palette to literal hex and
  // applied inline. The BOX (background + border) lives on a wrapper <view>,
  // not the native input: iOS's input element ignores post-mount inline
  // style updates, so a live theme switch left the field painted in the
  // previous palette (#993). Views repaint reliably on both platforms; the
  // input itself is transparent and carries only text metrics + colors
  // (which on iOS still refresh only on remount — the residual, low-stakes
  // part).
  const getBoxStyle = () => {
    const style: Record<string, string> = {
      backgroundColor: props.variant === 'ghost' ? 'transparent' : colors.colorOf('base-100'),
      // Keep the .input class's padding OFF the wrapper so the native field
      // spans the full box — a padding inset would shrink the tap target
      // that focuses the input.
      paddingLeft: '0px',
      paddingRight: '0px',
    };
    if (props.color) style.borderColor = colors.colorOf(props.color);
    else if (props.variant === 'bordered') style.borderColor = colors.colorOf('base-300');
    return style;
  };

  const getFieldStyle = () => {
    const m = FIELD_METRICS[props.size ?? 'md'];
    return {
      width: '100%',
      height: '100%',
      backgroundColor: 'transparent',
      borderWidth: '0px',
      paddingLeft: m.pad,
      paddingRight: m.pad,
      fontSize: m.fontSize,
      color: colors.colorOf('base-content'),
      '-x-placeholder-color': colors.colorOf('base-content', 0.45),
    };
  };

  return () => (
    <view class={getClasses()} style={getBoxStyle()}>
      <input
        style={getFieldStyle()}
        placeholder={props.placeholder}
        type={props.type ?? 'text'}
        disabled={props.disabled}
        model={props.model}
      />
    </view>
  );
});

// Text metrics per size, mirrored from this package's input.css rules
// (.input font-size/padding + the .input-{xs,sm,lg} overrides; note
// .input-lg deliberately uses a literal 20px, not --padding-btn-lg's
// 24px) — native inputs can't read the vars, so the literals live here;
// keep in sync with input.css.
const FIELD_METRICS: Record<InputSize, { fontSize: string; pad: string }> = {
  xs: { fontSize: '12px', pad: '8px' },
  sm: { fontSize: '14px', pad: '12px' },
  md: { fontSize: '14px', pad: '16px' },
  lg: { fontSize: '18px', pad: '20px' },
};
