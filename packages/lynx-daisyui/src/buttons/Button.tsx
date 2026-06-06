import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant, type SizeScale } from '@sigx/lynx-zero';
import { Loading } from '../feedback/Loading.js';

// The contract's `color` + DS-specific `variant` split (signalxjs/lynx#219):
// `color` is the semantic color (shared vocabulary across design systems);
// `variant` is daisy's fill style. They compose: `color="primary"
// variant="outline"` → `btn-primary btn-outline`.
export type ButtonColor = ColorVariant;

export type ButtonVariant = 'outline' | 'soft' | 'ghost' | 'link';

export type ButtonSize = SizeScale;

export type ButtonProps =
  & Define.Prop<'color', ButtonColor, false>
  & Define.Prop<'variant', ButtonVariant, false>
  & Define.Prop<'size', ButtonSize, false>
  & Define.Prop<'wide', boolean, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'loading', boolean, false>
  & Define.Prop<'block', boolean, false>
  & Define.Prop<'circle', boolean, false>
  & Define.Prop<'square', boolean, false>
  & Define.Prop<'active', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>
  & Define.Event<'press', void>;

const colorClasses: Record<ButtonColor, string> = {
  primary: 'btn-primary', secondary: 'btn-secondary', accent: 'btn-accent',
  neutral: 'btn-neutral', info: 'btn-info', success: 'btn-success',
  warning: 'btn-warning', error: 'btn-error',
};

const variantClasses: Record<ButtonVariant, string> = {
  outline: 'btn-outline', soft: 'btn-soft', ghost: 'btn-ghost', link: 'btn-link',
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'btn-xs', sm: 'btn-sm', md: '', lg: 'btn-lg', xl: 'btn-xl',
};

export const Button = component<ButtonProps>(({ props, slots, emit }) => {
  const getClasses = () => {
    const c = ['btn'];
    if (props.color) c.push(colorClasses[props.color]);
    if (props.variant) c.push(variantClasses[props.variant]);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.wide) c.push('btn-wide');
    if (props.loading) c.push('btn-loading');
    if (props.block) c.push('btn-block');
    if (props.circle) c.push('btn-circle');
    if (props.square) c.push('btn-square');
    if (props.active) c.push('btn-active');
    if (props.disabled) c.push('btn-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const inert = !!(props.disabled || props.loading);
    return (
      <Pressable
        class={getClasses()}
        disabled={inert}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        onPress={() => { if (!inert) emit('press'); }}
      >
        {props.loading
          ? <Loading type="spinner" size="sm" />
          : slots.default?.()}
      </Pressable>
    );
  };
});
