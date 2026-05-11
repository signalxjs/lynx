import { component, type Define } from '@sigx/lynx';

export type LoadingType = 'spinner' | 'dots' | 'ring' | 'ball' | 'bars' | 'infinity';
export type LoadingSize = 'xs' | 'sm' | 'md' | 'lg';
export type LoadingColor = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error';

export type LoadingProps =
  & Define.Prop<'type', LoadingType, false>
  & Define.Prop<'size', LoadingSize, false>
  & Define.Prop<'color', LoadingColor, false>
  & Define.Prop<'class', string, false>;

export const Loading = component<LoadingProps>(({ props }) => {
  const getClasses = () => {
    const c = ['loading'];
    c.push(`loading-${props.type ?? 'spinner'}`);
    if (props.size) c.push(`loading-${props.size}`);
    if (props.color) c.push(`text-${props.color}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()} />;
});
