import { component, type Define } from '@sigx/lynx';
import type { ColorVariant } from '@sigx/lynx-zero';

// The contract's `color` + DS-specific `variant` split (signalxjs/lynx#219):
// semantic color and fill style compose — `color="primary" variant="outline"`
// → `badge-primary badge-outline`.
export type BadgeColor = ColorVariant;
export type BadgeVariant = 'outline' | 'ghost';
export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

export type BadgeProps =
  & Define.Prop<'color', BadgeColor, false>
  & Define.Prop<'variant', BadgeVariant, false>
  & Define.Prop<'size', BadgeSize, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const Badge = component<BadgeProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = ['badge'];
    if (props.color) c.push(`badge-${props.color}`);
    if (props.variant) c.push(`badge-${props.variant}`);
    if (props.size) c.push(`badge-${props.size}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()}>{slots.default?.()}</view>;
});
