import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant } from '@sigx/lynx-zero';

export type CheckboxColor = Exclude<ColorVariant, 'neutral'>;
export type CheckboxSize = 'xs' | 'sm' | 'md' | 'lg';

export type CheckboxProps =
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', CheckboxColor, false>
  & Define.Prop<'size', CheckboxSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  // Two-way binding (the sigx way): `model={() => state.agreed}`. When a model
  // is bound it drives the checked state and the press writes back to it; the
  // static `checked` prop + `change` event still work when no model is bound.
  & Define.Model<boolean>
  & Define.Event<'change', boolean>;

const checkmarkSizeMap: Record<CheckboxSize, number> = {
  xs: 10, sm: 12, md: 14, lg: 19,
};

export const Checkbox = component<CheckboxProps>(({ props, emit }) => {
  const isChecked = () => (props.model ? !!props.model.value : !!props.checked);

  const getClasses = () => {
    const c = ['checkbox'];
    const size = props.size ?? 'md';
    if (size !== 'md') c.push(`checkbox-${size}`);
    if (props.color) c.push(`checkbox-${props.color}`);
    if (isChecked()) c.push('checkbox-checked');
    if (props.disabled) c.push('checkbox-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const checked = isChecked();
    const size = props.size ?? 'md';

    return (
      <Pressable
        class={getClasses()}
        disabled={!!props.disabled}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        onPress={() => {
          if (props.disabled) return;
          const next = !checked;
          if (props.model) props.model.value = next;
          emit('change', next);
        }}
      >
        {checked ? (
          <text class="checkbox-mark" style={{ fontSize: checkmarkSizeMap[size] }}>✓</text>
        ) : null}
      </Pressable>
    );
  };
});
