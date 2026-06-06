import { component, type Define, type Model } from '@sigx/lynx';
import type { ColorVariant } from '@sigx/lynx-zero';

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
  const getClasses = () => {
    const c = ['input'];
    if (props.variant === 'bordered') c.push('input-bordered');
    if (props.variant === 'ghost') c.push('input-ghost');
    if (props.color) c.push(`input-${props.color}`);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => (
    <input
      class={getClasses()}
      placeholder={props.placeholder}
      type={props.type ?? 'text'}
      disabled={props.disabled}
      model={props.model}
    />
  );
});
