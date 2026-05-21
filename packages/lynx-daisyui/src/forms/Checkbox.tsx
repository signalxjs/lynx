import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY } from '../shared/press';

export type CheckboxColor = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error';
export type CheckboxSize = 'xs' | 'sm' | 'md' | 'lg';

export type CheckboxProps =
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', CheckboxColor, false>
  & Define.Prop<'size', CheckboxSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Event<'change', boolean>;

const checkmarkSizeMap: Record<CheckboxSize, number> = {
  xs: 10, sm: 12, md: 14, lg: 19,
};

export const Checkbox = component<CheckboxProps>(({ props, emit }) => {
  const getClasses = () => {
    const c = ['checkbox'];
    const size = props.size ?? 'md';
    if (size !== 'md') c.push(`checkbox-${size}`);
    if (props.color) c.push(`checkbox-${props.color}`);
    if (props.checked) c.push('checkbox-checked');
    if (props.disabled) c.push('checkbox-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const checked = !!props.checked;
    const size = props.size ?? 'md';

    return (
      <Pressable
        class={getClasses()}
        disabled={!!props.disabled}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        onPress={() => {
          if (!props.disabled) emit('change', !checked);
        }}
      >
        {checked ? (
          <text class="checkbox-mark" style={{ fontSize: checkmarkSizeMap[size] }}>✓</text>
        ) : null}
      </Pressable>
    );
  };
});
