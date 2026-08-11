import { component, useWidthClass, type Define, type WidthClass } from '@sigx/lynx';
import { resolveResponsive, type Responsive } from '../shared/responsive.js';

export type ScrollViewProps =
  & Define.Prop<'direction', Responsive<'vertical' | 'horizontal'>, false>
  & Define.Prop<'height', Responsive<number | string>, false>
  & Define.Prop<'width', Responsive<number | string>, false>
  & Define.Prop<'flex', Responsive<number>, false>
  & Define.Prop<'showScrollbar', boolean, false>
  & Define.Prop<'bounces', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const ScrollView = component<ScrollViewProps>(({ props, slots }) => {
  const widthClass = useWidthClass();

  const getStyle = (cls: WidthClass): Record<string, string | number> => {
    const style: Record<string, string | number> = {};
    const height = resolveResponsive(props.height, cls);
    const width = resolveResponsive(props.width, cls);
    const flex = resolveResponsive(props.flex, cls);
    if (height !== undefined) style.height = height;
    if (width !== undefined) style.width = width;
    if (flex !== undefined) style.flex = flex;
    return style;
  };

  return () => {
    const cls = widthClass.value;
    const dir = resolveResponsive(props.direction, cls) ?? 'vertical';
    return (
      <scroll-view
        class={props.class}
        style={getStyle(cls)}
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
