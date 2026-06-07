import { component, type Define } from '@sigx/lynx';
import type { ColorVariant } from '@sigx/lynx-zero';

/** Alerts carry the status colors (upstream HeroUI flat surface). */
export type AlertColor = Extract<ColorVariant, 'info' | 'success' | 'warning' | 'error'>;

export type AlertProps =
  & Define.Prop<'color', AlertColor, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const Alert = component<AlertProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = ['hero-alert'];
    c.push(`hero-alert-${props.color ?? 'info'}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()}>{slots.default?.()}</view>;
});
