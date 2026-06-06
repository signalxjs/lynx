import { component, type Define } from '@sigx/lynx';
import type { ColorVariant, SizeScale } from '@sigx/lynx-zero';

export type InputSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;
/** Upstream HeroUI input variants — flat (filled surface) is the default. */
export type InputVariant = 'flat' | 'bordered';
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
  sm: 'hero-input-sm', md: '', lg: 'hero-input-lg',
};

export const Input = component<InputProps>(({ props }) => {
  const getClasses = () => {
    const c = ['hero-input'];
    if (props.variant === 'bordered') c.push('hero-input-bordered');
    if (props.color) c.push(`hero-input-${props.color}`);
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
