import { component, compound, defineInjectable, defineProvide, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import {
  PRESSED_SCALE,
  PRESSED_OPACITY,
  type ColorVariant,
  type SizeScale,
  type WithAccessibility,
} from '@sigx/lynx-zero';

export type RadioColor = Exclude<ColorVariant, 'neutral'>;
export type RadioSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;

export type RadioGroupProps =
  & Define.Prop<'value', string, false>
  & Define.Prop<'color', RadioColor, false>
  & Define.Prop<'size', RadioSize, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>
  // Two-way binding (the sigx way): bind the group to a signal —
  // `model={() => plan.value}` — and give each item its own `value`. Selecting
  // an item writes its `value` into the model; an item is checked when the
  // model equals its `value`. The static `value` prop is honored as display-only
  // initial selection when no model is bound. There is no `change` event: a prop
  // named `value` trips runtime-core's emit lookup, so use `model` for
  // interactivity.
  & Define.Model<string>;

export type RadioItemProps =
  // Optional for parity with daisy's Radio.Item — supports purely controlled
  // use (`checked` without group-driven selection). The onPress guard below
  // no-ops when it's absent.
  & Define.Prop<'value', string, false>
  & Define.Prop<'label', string, false>
  & Define.Prop<'disabled', boolean, false>
  /** Explicit override — when set, wins over the group's selection. */
  & Define.Prop<'checked', boolean, false>
  & Define.Prop<'color', RadioColor, false>
  & Define.Prop<'size', RadioSize, false>
  & Define.Prop<'class', string, false>
  & WithAccessibility;

// Headless group selection (mirrors zero's TabsSelection shape): the group
// publishes the active value + shared color/size defaults; items read it so a
// group-level `model`/`value`/`color`/`size` actually drives them, while a
// per-item prop still wins.
interface RadioSelection {
  value: () => string | undefined;
  color: () => RadioColor | undefined;
  size: () => RadioSize | undefined;
  select: (value: string) => void;
}
const useRadioGroup = defineInjectable<RadioSelection | null>(() => null);

const sizeClasses: Record<RadioSize, string> = {
  sm: 'hero-radio-sm', md: '', lg: 'hero-radio-lg',
};

const RadioItem = component<RadioItemProps>(({ props }) => {
  const group = useRadioGroup();

  return () => {
    const color = props.color ?? group?.color();
    const size = props.size ?? group?.size();
    // Guard `props.value != null` so an item that forgot a value isn't treated
    // as selected when the group value is also undefined (undefined === undefined).
    const checked = props.checked
      ?? (group != null && props.value != null && group.value() === props.value);

    const getClasses = () => {
      const c = ['hero-radio'];
      if (color) c.push(`hero-radio-${color}`);
      if (size) { const s = sizeClasses[size]; if (s) c.push(s); }
      if (checked) c.push('hero-radio-checked');
      if (props.class) c.push(props.class);
      return c.join(' ');
    };

    return (
      <Pressable
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: props.disabled ? 0.5 : 1 }}
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
          if (props.disabled || props.value == null) return;
          group?.select(props.value);
        }}
      >
        <view class={getClasses()}>
          {checked ? <view class="hero-radio-mark" /> : null}
        </view>
        {props.label ? <text class="hero-radio-label">{props.label}</text> : null}
      </Pressable>
    );
  };
});

const _RadioGroup = component<RadioGroupProps>(({ props, slots }) => {
  defineProvide(useRadioGroup, () => ({
    // The bound model wins, else the static `value` prop (display-only).
    value: () => (props.model ? props.model.value : props.value),
    color: () => props.color,
    size: () => props.size,
    select: (value: string) => { if (props.model) props.model.value = value; },
  }));

  return () => (
    <view class={props.class ?? ''} style={{ gap: 8 }}>
      {slots.default?.()}
    </view>
  );
});

export const Radio = compound(_RadioGroup, {
  Item: RadioItem,
});
