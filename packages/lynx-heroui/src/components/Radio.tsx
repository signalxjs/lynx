import { component, compound, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant, type SizeScale } from '@sigx/lynx-zero';

export type RadioColor = Exclude<ColorVariant, 'neutral'>;
export type RadioSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;

export type RadioGroupProps =
  & Define.Prop<'value', string, false>
  & Define.Prop<'color', RadioColor, false>
  & Define.Prop<'size', RadioSize, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>
  & Define.Event<'change', string>;

export type RadioItemProps =
  & Define.Prop<'value', string, true>
  & Define.Prop<'label', string, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', RadioColor, false>
  & Define.Prop<'size', RadioSize, false>
  & Define.Prop<'class', string, false>
  & Define.Event<'select', string>;

const sizeClasses: Record<RadioSize, string> = {
  sm: 'hero-radio-sm', md: '', lg: 'hero-radio-lg',
};

const RadioItem = component<RadioItemProps>(({ props, emit }) => {
  const getClasses = () => {
    const c = ['hero-radio'];
    if (props.color) c.push(`hero-radio-${props.color}`);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.checked) c.push('hero-radio-checked');
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
        if (!props.disabled && props.value != null) emit('select', props.value);
      }}
    >
      <view class={getClasses()}>
        {props.checked ? <view class="hero-radio-mark" /> : null}
      </view>
      {props.label ? <text class="hero-radio-label">{props.label}</text> : null}
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
