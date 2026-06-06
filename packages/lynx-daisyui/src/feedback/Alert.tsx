import { component, type Define } from '@sigx/lynx';
import type { ColorVariant } from '@sigx/lynx-zero';

// Semantic `color` per the shared contract (signalxjs/lynx#219); alerts only
// support the status colors.
export type AlertColor = Extract<ColorVariant, 'info' | 'success' | 'warning' | 'error'>;

export type AlertProps =
  & Define.Prop<'color', AlertColor, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const Alert = component<AlertProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = ['alert'];
    if (props.color) c.push(`alert-${props.color}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()}>{slots.default?.()}</view>;
});
