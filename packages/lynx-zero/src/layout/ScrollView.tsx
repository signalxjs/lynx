import { component, type Define } from '@sigx/lynx';

export type ScrollViewProps =
  & Define.Prop<'direction', 'vertical' | 'horizontal', false>
  & Define.Prop<'height', number | string, false>
  & Define.Prop<'width', number | string, false>
  & Define.Prop<'flex', number, false>
  & Define.Prop<'showScrollbar', boolean, false>
  & Define.Prop<'bounces', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const ScrollView = component<ScrollViewProps>(({ props, slots }) => {
  const getStyle = (): Record<string, string | number> => {
    const style: Record<string, string | number> = {};
    if (props.height !== undefined) style.height = props.height;
    if (props.width !== undefined) style.width = props.width;
    if (props.flex !== undefined) style.flex = props.flex;
    return style;
  };

  return () => {
    const dir = props.direction ?? 'vertical';
    return (
      <scroll-view
        class={props.class}
        style={getStyle()}
        scroll-orientation={dir}
        scroll-y={dir === 'vertical' ? true : undefined}
        scroll-x={dir === 'horizontal' ? true : undefined}
        show-scrollbar={props.showScrollbar}
        bounces={props.bounces}
      >
        {slots.default?.()}
      </scroll-view>
    );
  };
});
