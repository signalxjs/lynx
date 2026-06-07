import { component, type Define } from '@sigx/lynx';
import type { ColorVariant, SizeScale } from '@sigx/lynx-zero';

export type LoadingSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;
export type LoadingColor = Exclude<ColorVariant, 'neutral'>;

export type LoadingProps =
  & Define.Prop<'size', LoadingSize, false>
  & Define.Prop<'color', LoadingColor, false>
  & Define.Prop<'class', string, false>;

const sizeClasses: Record<LoadingSize, string> = {
  sm: 'hero-loading-sm', md: '', lg: 'hero-loading-lg',
};

/** Spinner — a rotating ring; color tints the leading arc. */
export const Loading = component<LoadingProps>(({ props }) => {
  const getClasses = () => {
    const c = ['hero-loading'];
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.color) c.push(`hero-loading-${props.color}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()} />;
});
