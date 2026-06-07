import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant, type SizeScale, type WithAccessibility } from '@sigx/lynx-zero';

export type CheckboxColor = Exclude<ColorVariant, 'neutral'>;
export type CheckboxSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;

export type CheckboxProps =
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', CheckboxColor, false>
  & Define.Prop<'size', CheckboxSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  & WithAccessibility
  & Define.Event<'change', boolean>;

const checkmarkSizeMap: Record<CheckboxSize, number> = {
  sm: 12, md: 14, lg: 18,
};

const sizeClasses: Record<CheckboxSize, string> = {
  sm: 'hero-checkbox-sm', md: '', lg: 'hero-checkbox-lg',
};

export const Checkbox = component<CheckboxProps>(({ props, emit }) => {
  const getClasses = () => {
    const c = ['hero-checkbox'];
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.color) c.push(`hero-checkbox-${props.color}`);
    if (props.checked) c.push('hero-checkbox-checked');
    if (props.disabled) c.push('hero-checkbox-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const checked = !!props.checked;

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
          if (!props.disabled) emit('change', !checked);
        }}
      >
        {checked ? (
          <text class="hero-checkbox-mark" style={{ fontSize: checkmarkSizeMap[props.size ?? 'md'] }}>✓</text>
        ) : null}
      </Pressable>
    );
  };
});
