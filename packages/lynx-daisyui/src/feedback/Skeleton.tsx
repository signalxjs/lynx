import { component, type Define } from '@sigx/lynx';

export type SkeletonProps =
  & Define.Prop<'width', number | string, false>
  & Define.Prop<'height', number | string, false>
  & Define.Prop<'circle', boolean, false>
  & Define.Prop<'class', string, false>;

export const Skeleton = component<SkeletonProps>(({ props }) => {
  return () => {
    const style: Record<string, any> = {};

    if (props.width != null) style.width = props.width;
    if (props.height != null) style.height = props.height;

    if (props.circle) {
      const size = props.width ?? props.height ?? 48;
      style.width = size;
      style.height = size;
      style.borderRadius = typeof size === 'number' ? size / 2 : '50%';
    }

    return (
      <view
        class={`skeleton${props.class ? ' ' + props.class : ''}`}
        style={style}
      />
    );
  };
});
