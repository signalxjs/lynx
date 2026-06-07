import { component, compound, type Define } from '@sigx/lynx';
import type { ColorVariant } from '@sigx/lynx-zero';

export type StepColor = ColorVariant;

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
  return () => (
    <view class={`hero-steps${props.vertical ? ' hero-steps-vertical' : ' hero-steps-horizontal'}${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

const Step = component<StepProps>(({ props, slots }) => {
  return () => {
    const colorClass = props.color ? ` hero-step-${props.color}` : '';
    return (
      <view class={`hero-step${colorClass}${props.class ? ' ' + props.class : ''}`}>
        <view class={`hero-step-indicator${colorClass}`}>
          {props.content ? <text class="hero-step-content">{props.content}</text> : null}
        </view>
        {slots.default?.()}
      </view>
    );
  };
});

export const Steps = compound(_Steps, { Step });
