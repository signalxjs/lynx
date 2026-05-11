import { component, type Define } from '@sigx/lynx';

export type BadgeVariant = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error' | 'neutral' | 'ghost';
export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

export type BadgeProps =
  & Define.Prop<'variant', BadgeVariant, false>
  & Define.Prop<'size', BadgeSize, false>
  & Define.Prop<'outline', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const Badge = component<BadgeProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = ['badge'];
    if (props.variant) c.push(`badge-${props.variant}`);
    if (props.size) c.push(`badge-${props.size}`);
    if (props.outline) c.push('badge-outline');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()}>{slots.default?.()}</view>;
});
