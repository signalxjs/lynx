import { component, type Define } from '@sigx/lynx';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export type AlertProps =
  & Define.Prop<'variant', AlertVariant, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const Alert = component<AlertProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = ['alert'];
    if (props.variant) c.push(`alert-${props.variant}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()}>{slots.default?.()}</view>;
});
