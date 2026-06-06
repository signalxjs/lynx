import { component, type Define } from '@sigx/lynx';
import type { BackgroundValue } from '../contract.js';
import { type SpacingValue, resolveBoxStyle } from '../shared/styles.js';

export type RowProps =
  & Define.Prop<'gap', number, false>
  & Define.Prop<'align', 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline', false>
  & Define.Prop<'justify', 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly', false>
  & Define.Prop<'wrap', boolean, false>
  & Define.Prop<'padding', SpacingValue, false>
  & Define.Prop<'margin', SpacingValue, false>
  & Define.Prop<'width', number | string, false>
  & Define.Prop<'height', number | string, false>
  & Define.Prop<'flex', number, false>
  & Define.Prop<'background', BackgroundValue, false>
  & Define.Prop<'borderRadius', number, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const Row = component<RowProps>(({ props, slots }) => {
  const getStyle = (): Record<string, string | number> => {
    const style: Record<string, string | number> = {
      display: 'flex',
      flexDirection: 'row',
    };

    if (props.gap !== undefined) style.gap = props.gap;
    if (props.align) style.alignItems = props.align;
    if (props.justify) style.justifyContent = props.justify;
    if (props.wrap) style.flexWrap = 'wrap';

    const box = resolveBoxStyle({
      width: props.width,
      height: props.height,
      flex: props.flex,
      background: props.background,
      borderRadius: props.borderRadius,
      padding: props.padding,
      margin: props.margin,
    });
    for (const key in box) {
      style[key] = box[key] as string | number;
    }

    return style;
  };

  return () => (
    <view class={props.class} style={getStyle()}>
      {slots.default?.()}
    </view>
  );
});
