import { component, signal, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant } from '@sigx/lynx-zero';

export type SelectSize = 'xs' | 'sm' | 'md' | 'lg';
export type SelectVariant = 'bordered' | 'ghost';
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
  // Two-way binding (the sigx way): `model={() => state.country}`. Picking an
  // option writes its value into the model. The static `value` prop is honored
  // when no model is bound (controlled/showcase rows).
  & Define.Model<string>;

// Only one dropdown is open at a time across the whole tree. Each instance
// claims a unique id and the shared signal holds whichever is currently open,
// so opening one select collapses any other (no stacked/sticky menus).
let nextSelectId = 0;
const openSelectId = signal<number | null>(null);

export const Select = component<SelectProps>(({ props }) => {
  const id = nextSelectId++;
  const isOpen = () => openSelectId.value === id;

  // Resolved selection: the bound model wins, else the static `value` prop.
  const selectedValue = () => (props.model ? props.model.value : props.value);

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
    const found = opts.find((o) => o.value === selectedValue());
    return found ? found.label : (props.placeholder ?? 'Select...');
  };

  return () => (
    <view style={{ opacity: props.disabled ? 0.5 : 1 }}>
      <Pressable
        class={getClasses()}
        disabled={!!props.disabled}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        onPress={() => {
          if (props.disabled) return;
          openSelectId.value = isOpen() ? null : id;
        }}
      >
        <text>{getSelectedLabel()}</text>
        <view style={{ marginLeft: 'auto' }}><text>{isOpen() ? '▲' : '▼'}</text></view>
      </Pressable>

      {/* Rendered in-flow (expands the row, pushing siblings down) rather than
          absolutely positioned: Lynx doesn't reliably resolve `top: 100%`
          against a `position: relative` ancestor, which detached the menu. */}
      {isOpen() && !props.disabled && (
        <view class="select-dropdown" style={{ marginTop: 4 }}>
          {(props.options ?? []).map((option) => (
            <Pressable
              class={`select-option${option.value === selectedValue() ? ' select-option-active' : ''}`}
              pressedScale={PRESSED_SCALE}
              pressedOpacity={PRESSED_OPACITY}
              longPressDuration={0}
              onPress={() => {
                if (props.model) props.model.value = option.value;
                openSelectId.value = null;
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
