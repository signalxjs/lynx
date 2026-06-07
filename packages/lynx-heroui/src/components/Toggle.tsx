import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant, type SizeScale } from '@sigx/lynx-zero';

export type ToggleColor = Exclude<ColorVariant, 'neutral'>;
export type ToggleSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;

export type ToggleProps =
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', ToggleColor, false>
  & Define.Prop<'size', ToggleSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
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
  const getClasses = () => {
    const c = ['hero-toggle'];
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.color) c.push(`hero-toggle-${props.color}`);
    if (props.checked) c.push('hero-toggle-checked');
    if (props.disabled) c.push('hero-toggle-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const checked = !!props.checked;
    const offset = checked ? thumbOffsetMap[props.size ?? 'md'] : 0;

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
        <view
          class="hero-toggle-thumb"
          style={{ transform: `translateX(${offset}px)` }}
        />
      </Pressable>
    );
  };
});
