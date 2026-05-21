import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { Loading } from '../feedback/Loading';
import { PRESSED_SCALE, PRESSED_OPACITY } from '../shared/press';

export type ButtonVariant =
  | 'primary' | 'secondary' | 'accent' | 'info'
  | 'success' | 'warning' | 'error' | 'ghost'
  | 'link' | 'neutral';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type ButtonProps =
  & Define.Prop<'variant', ButtonVariant, false>
  & Define.Prop<'size', ButtonSize, false>
  & Define.Prop<'outline', boolean, false>
  & Define.Prop<'soft', boolean, false>
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

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'btn-primary', secondary: 'btn-secondary', accent: 'btn-accent',
  info: 'btn-info', success: 'btn-success', warning: 'btn-warning',
  error: 'btn-error', ghost: 'btn-ghost', link: 'btn-link', neutral: 'btn-neutral',
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'btn-xs', sm: 'btn-sm', md: '', lg: 'btn-lg', xl: 'btn-xl',
};

export const Button = component<ButtonProps>(({ props, slots, emit }) => {
  const getClasses = () => {
    const c = ['btn'];
    if (props.variant) c.push(variantClasses[props.variant]);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.outline) c.push('btn-outline');
    if (props.soft) c.push('btn-soft');
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
