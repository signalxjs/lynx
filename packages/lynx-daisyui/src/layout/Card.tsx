import { component, compound, type Define } from '@sigx/lynx';

export type CardProps =
  & Define.Prop<'bordered', boolean, false>
  & Define.Prop<'shadow', boolean | 'sm' | 'md' | 'lg', false>
  & Define.Prop<'compact', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const _Card = component<CardProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = ['card'];
    if (props.bordered) c.push('card-bordered');
    if (props.compact) c.push('card-compact');
    if (props.shadow === true) c.push('shadow-md');
    else if (props.shadow === 'sm') c.push('shadow-sm');
    else if (props.shadow === 'md') c.push('shadow-md');
    else if (props.shadow === 'lg') c.push('shadow-lg');
    else if (props.shadow === undefined) c.push('shadow-md');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => <view class={getClasses()}>{slots.default?.()}</view>;
});

type CardBodyProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;
const CardBody = component<CardBodyProps>(({ props, slots }) => {
  return () => (
    <view class={`card-body${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

type CardTitleProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;
const CardTitle = component<CardTitleProps>(({ props, slots }) => {
  return () => (
    <text class={`card-title${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </text>
  );
});

type CardActionsProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;
const CardActions = component<CardActionsProps>(({ props, slots }) => {
  return () => (
    <view class={`card-actions${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

export const Card = compound(_Card, {
  Body: CardBody,
  Title: CardTitle,
  Actions: CardActions,
});
