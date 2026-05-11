import { component, compound, type Define } from '@sigx/lynx';

export type RadioColor = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error';
export type RadioSize = 'xs' | 'sm' | 'md' | 'lg';

export type RadioGroupProps =
  & Define.Prop<'value', string, false>
  & Define.Prop<'color', RadioColor, false>
  & Define.Prop<'size', RadioSize, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>
  & Define.Event<'change', string>;

export type RadioItemProps =
  & Define.Prop<'value', string, false>
  & Define.Prop<'label', string, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', RadioColor, false>
  & Define.Prop<'size', RadioSize, false>
  & Define.Prop<'class', string, false>
  & Define.Event<'select', string>;

const RadioItem = component<RadioItemProps>(({ props, emit }) => {
  const getClasses = () => {
    const c = ['radio'];
    if (props.color) c.push(`radio-${props.color}`);
    if (props.size) c.push(`radio-${props.size}`);
    if (props.checked) c.push('radio-checked');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => (
    <view
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: props.disabled ? 0.5 : 1 }}
      bindtap={() => {
        if (!props.disabled && props.value != null) emit('select', props.value);
      }}
    >
      <view class={getClasses()}>
        {props.checked && <view class="radio-mark" />}
      </view>
      {props.label && <text>{props.label}</text>}
    </view>
  );
});

const _RadioGroup = component<RadioGroupProps>(({ props, slots }) => {
  return () => (
    <view class={props.class ?? ''} style={{ gap: 8 }}>
      {slots.default?.()}
    </view>
  );
});

export const Radio = compound(_RadioGroup, {
  Item: RadioItem,
});
