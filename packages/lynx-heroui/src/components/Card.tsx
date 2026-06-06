import { component, compound, type Define } from '@sigx/lynx';

export type CardProps =
  & Define.Prop<'bordered', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const _Card = component<CardProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = ['hero-card'];
    if (props.bordered) c.push('hero-card-bordered');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()}>{slots.default?.()}</view>;
});

type CardBodyProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;
const CardBody = component<CardBodyProps>(({ props, slots }) => {
  return () => (
    <view class={`hero-card-body${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

export const Card = compound(_Card, {
  Body: CardBody,
});
