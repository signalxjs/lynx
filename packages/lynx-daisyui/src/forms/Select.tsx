import { component, signal, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY } from '../shared/press.js';

export type SelectSize = 'xs' | 'sm' | 'md' | 'lg';
export type SelectVariant = 'bordered' | 'ghost';
export type SelectColor = 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error';

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
  & Define.Event<'change', string>;

export const Select = component<SelectProps>(({ props, emit }) => {
  const state = signal({ open: false });

  const getClasses = () => {
    const c = ['select'];
    if (props.variant === 'bordered') c.push('select-bordered');
    if (props.variant === 'ghost') c.push('select-ghost');
    if (props.color) c.push(`select-${props.color}`);
    if (props.size) c.push(`select-${props.size}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  const getSelectedLabel = () => {
    const opts = props.options ?? [];
    const found = opts.find((o) => o.value === props.value);
    return found ? found.label : (props.placeholder ?? 'Select...');
  };

  return () => (
    <view style={{ position: 'relative', opacity: props.disabled ? 0.5 : 1 }}>
      <Pressable
        class={getClasses()}
        disabled={!!props.disabled}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        onPress={() => {
          if (!props.disabled) state.open = !state.open;
        }}
      >
        <text>{getSelectedLabel()}</text>
        <view style={{ marginLeft: 'auto' }}><text>{state.open ? '▲' : '▼'}</text></view>
      </Pressable>

      {state.open && !props.disabled && (
        <view class="select-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10 }}>
          {(props.options ?? []).map((option) => (
            <Pressable
              class={`select-option${option.value === props.value ? ' select-option-active' : ''}`}
              pressedScale={PRESSED_SCALE}
              pressedOpacity={PRESSED_OPACITY}
              longPressDuration={0}
              onPress={() => {
                emit('change', option.value);
                state.open = false;
              }}
            >
              <text>{option.label}</text>
            </Pressable>
          ))}
        </view>
      )}
    </view>
  );
});
