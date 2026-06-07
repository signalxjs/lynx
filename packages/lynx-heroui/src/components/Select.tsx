import { component, signal, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant, type SizeScale, type WithAccessibility } from '@sigx/lynx-zero';

export type SelectSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;
/** Upstream HeroUI select variants — flat (filled surface) is the default. */
export type SelectVariant = 'flat' | 'bordered';
export type SelectColor = Exclude<ColorVariant, 'neutral'>;

export interface SelectOption {
  label: string;
  value: string;
}

export type SelectProps =
  & Define.Prop<'options', SelectOption[], false>
  & Define.Prop<'value', string, false>
  & Define.Prop<'placeholder', string, false>
  & Define.Prop<'size', SelectSize, false>
  & Define.Prop<'variant', SelectVariant, false>
  & Define.Prop<'color', SelectColor, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  & WithAccessibility
  & Define.Event<'change', string>;

const sizeClasses: Record<SelectSize, string> = {
  sm: 'hero-select-sm', md: '', lg: 'hero-select-lg',
};

export const Select = component<SelectProps>(({ props, emit }) => {
  const state = signal({ open: false });

  const getClasses = () => {
    const c = ['hero-select'];
    if (props.variant === 'bordered') c.push('hero-select-bordered');
    if (props.color) c.push(`hero-select-${props.color}`);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  const getSelectedLabel = () => {
    const found = (props.options ?? []).find((o) => o.value === props.value);
    return found ? found.label : (props.placeholder ?? 'Select…');
  };

  return () => (
    <view style={{ position: 'relative', opacity: props.disabled ? 0.5 : 1 }}>
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
          if (!props.disabled) state.open = !state.open;
        }}
      >
        <text class="hero-select-label">{getSelectedLabel()}</text>
        <text class="hero-select-caret">{state.open ? '▲' : '▼'}</text>
      </Pressable>

      {state.open && !props.disabled ? (
        <view class={`hero-select-dropdown${props.color ? ' hero-select-' + props.color : ''}`} style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10 }}>
          {(props.options ?? []).map((option) => (
            <Pressable
              key={option.value}
              class={`hero-select-option${option.value === props.value ? ' hero-select-option-active' : ''}`}
              pressedScale={PRESSED_SCALE}
              pressedOpacity={PRESSED_OPACITY}
              longPressDuration={0}
              accessibility-element={true}
              accessibility-label={option.label}
              accessibility-trait="button"
              onPress={() => {
                emit('change', option.value);
                state.open = false;
              }}
            >
              <text class="hero-select-option-label">{option.label}</text>
            </Pressable>
          ))}
        </view>
      ) : null}
    </view>
  );
});
