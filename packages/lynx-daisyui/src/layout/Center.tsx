import { component, type Define } from '@sigx/lynx';
import { type BackgroundValue, resolveBoxStyle } from '../shared/styles.js';

export type CenterProps =
  & Define.Prop<'width', number | string, false>
  & Define.Prop<'height', number | string, false>
  & Define.Prop<'flex', number, false>
  & Define.Prop<'background', BackgroundValue, false>
  & Define.Prop<'borderRadius', number, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const Center = component<CenterProps>(({ props, slots }) => {
  const getStyle = (): Record<string, string | number> => {
    const style: Record<string, string | number> = {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    };

    const box = resolveBoxStyle({
      width: props.width,
      height: props.height,
      flex: props.flex,
      background: props.background,
      borderRadius: props.borderRadius,
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
