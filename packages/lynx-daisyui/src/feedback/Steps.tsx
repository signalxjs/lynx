import { component, compound, type Define } from '@sigx/lynx';

export type StepColor = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

export type StepsProps =
  & Define.Prop<'vertical', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export type StepProps =
  & Define.Prop<'color', StepColor, false>
  & Define.Prop<'content', string, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const _Steps = component<StepsProps>(({ props, slots }) => {
  return () => {
    const isVertical = props.vertical ?? false;

    return (
      <view
        class={`steps${isVertical ? ' steps-vertical' : ' steps-horizontal'}${props.class ? ' ' + props.class : ''}`}
      >
        {slots.default?.()}
      </view>
    );
  };
});

const Step = component<StepProps>(({ props, slots }) => {
  return () => {
    const color = props.color;
    const colorClass = color ? ` step-${color}` : '';

    return (
      <view class={`step${colorClass}${props.class ? ' ' + props.class : ''}`}>
        <view class={`step-indicator${colorClass}`}>
          {props.content ? <text style={{ fontSize: 14 }}>{props.content}</text> : null}
        </view>
        {slots.default?.()}
      </view>
    );
  };
});

export const Steps = compound(_Steps, { Step });
