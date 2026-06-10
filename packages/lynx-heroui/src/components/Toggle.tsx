import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant, type SizeScale, type WithAccessibility } from '@sigx/lynx-zero';

export type ToggleColor = Exclude<ColorVariant, 'neutral'>;
export type ToggleSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;

export type ToggleProps =
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', ToggleColor, false>
  & Define.Prop<'size', ToggleSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  & WithAccessibility
  // Two-way binding (the sigx way): `model={() => state.on}`. When a model is
  // bound it drives the on/off state and the press writes back to it; the
  // static `checked` prop + `change` event still work when no model is bound.
  & Define.Model<boolean>
  & Define.Event<'change', boolean>;

// Track-width minus thumb-width minus padding, per size — how far the thumb
// travels when checked (kept in sync with the dimensions in toggle.css).
const thumbOffsetMap: Record<ToggleSize, number> = {
  sm: 16, md: 20, lg: 24,
};

const sizeClasses: Record<ToggleSize, string> = {
  sm: 'hero-toggle-sm', md: '', lg: 'hero-toggle-lg',
};

export const Toggle = component<ToggleProps>(({ props, emit }) => {
  const isChecked = () => (props.model ? !!props.model.value : !!props.checked);

  const getClasses = () => {
    const c = ['hero-toggle'];
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.color) c.push(`hero-toggle-${props.color}`);
    if (isChecked()) c.push('hero-toggle-checked');
    if (props.disabled) c.push('hero-toggle-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const checked = isChecked();
    const offset = checked ? thumbOffsetMap[props.size ?? 'md'] : 0;

    return (
      <Pressable
        class={getClasses()}
        disabled={!!props.disabled}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        accessibility-element={props['accessibility-element']}
        accessibility-label={props['accessibility-label']}
        accessibility-role={props['accessibility-role']}
        accessibility-trait={props['accessibility-trait']}
        accessibility-status={props['accessibility-status']}
        onPress={() => {
          if (props.disabled) return;
          const next = !checked;
          if (props.model) props.model.value = next;
          emit('change', next);
        }}
      >
        <view
          class="hero-toggle-thumb"
          style={{ transform: `translateX(${offset}px)` }}
        />
      </Pressable>
    );
  };
});
