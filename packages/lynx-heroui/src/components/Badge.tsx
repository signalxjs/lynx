import { component, type Define } from '@sigx/lynx';
import type { ColorVariant, SizeScale } from '@sigx/lynx-zero';

export type BadgeColor = ColorVariant;
/** Hero fill styles — solid (default), flat (soft tint), bordered. */
export type BadgeVariant = 'solid' | 'flat' | 'bordered';
export type BadgeSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;

export type BadgeProps =
  & Define.Prop<'color', BadgeColor, false>
  & Define.Prop<'variant', BadgeVariant, false>
  & Define.Prop<'size', BadgeSize, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'hero-badge-sm', md: '', lg: 'hero-badge-lg',
};

export const Badge = component<BadgeProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = ['hero-badge'];
    c.push(`hero-badge-${props.color ?? 'neutral'}`);
    if (props.variant && props.variant !== 'solid') c.push(`hero-badge-${props.variant}`);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <text class={getClasses()}>{slots.default?.()}</text>;
});
