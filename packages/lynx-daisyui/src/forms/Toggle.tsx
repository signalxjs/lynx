import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant } from '@sigx/lynx-zero';

export type ToggleColor = Exclude<ColorVariant, 'neutral'>;
export type ToggleSize = 'xs' | 'sm' | 'md' | 'lg';

export type ToggleProps =
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', ToggleColor, false>
  & Define.Prop<'size', ToggleSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  // Two-way binding (the sigx way): `model={() => state.on}`. When a model is
  // bound it drives the on/off state and the press writes back to it; the
  // static `checked` prop + `change` event still work when no model is bound.
  & Define.Model<boolean>
  & Define.Event<'change', boolean>;

const thumbOffsetMap: Record<ToggleSize, number> = {
  xs: 10, sm: 16, md: 20, lg: 24,
};

export const Toggle = component<ToggleProps>(({ props, emit }) => {
  const isChecked = () => (props.model ? !!props.model.value : !!props.checked);

  const getClasses = () => {
    const c = ['toggle'];
    const size = props.size ?? 'md';
    c.push(`toggle-${size}`);
    if (props.color) c.push(`toggle-${props.color}`);
    if (isChecked()) c.push('toggle-checked');
    if (props.disabled) c.push('toggle-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const checked = isChecked();
    const size = props.size ?? 'md';
    const offset = checked ? thumbOffsetMap[size] : 0;

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
        <view
          class="toggle-thumb"
          style={{ transform: `translateX(${offset}px)` }}
        />
      </Pressable>
    );
  };
});
