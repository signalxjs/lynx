import { component, compound, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant } from '@sigx/lynx-zero';

export type RadioColor = Exclude<ColorVariant, 'neutral'>;
export type RadioSize = 'xs' | 'sm' | 'md' | 'lg';

export type RadioGroupProps =
  & Define.Prop<'color', RadioColor, false>
  & Define.Prop<'size', RadioSize, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export type RadioItemProps =
  & Define.Prop<'value', string, false>
  & Define.Prop<'label', string, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', RadioColor, false>
  & Define.Prop<'size', RadioSize, false>
  & Define.Prop<'class', string, false>
  // Two-way binding (the sigx way): bind every item in a group to the same
  // signal — `model={() => plan.value}` — and give each its own `value`.
  // Selecting an item writes its `value` into the model; an item is checked
  // when the model equals its `value`. The static `checked` prop is honored
  // when no model is bound (variant/showcase rows).
  & Define.Model<string>;

const RadioItem = component<RadioItemProps>(({ props }) => {
  const isChecked = () =>
    props.model ? props.model.value === props.value : !!props.checked;

  const getClasses = () => {
    const c = ['radio'];
    if (props.color) c.push(`radio-${props.color}`);
    if (props.size) c.push(`radio-${props.size}`);
    if (isChecked()) c.push('radio-checked');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => (
    <Pressable
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: props.disabled ? 0.5 : 1 }}
      disabled={!!props.disabled}
      pressedScale={PRESSED_SCALE}
      pressedOpacity={PRESSED_OPACITY}
      longPressDuration={0}
      onPress={() => {
        if (props.disabled || props.value == null) return;
        if (props.model) props.model.value = props.value;
      }}
    >
      <view class={getClasses()}>
        {isChecked() && <view class="radio-mark" />}
      </view>
      {props.label && <text>{props.label}</text>}
    </Pressable>
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
