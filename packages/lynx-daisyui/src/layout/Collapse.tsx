import { component, compound, defineInjectable, defineProvide, signal, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_OPACITY } from '@sigx/lynx-zero';

export type CollapseIcon = 'arrow' | 'plus' | 'none';

// --- Accordion grouping context ---------------------------------------------
// A `Collapse.Group` provides this; child `Collapse`s with a `value` inject it
// to derive their open state and report toggles, so only one is open at a time
// (mirrors the Tabs `provideTabsSelection` / HeroUI Radio group pattern).
interface CollapseGroupState {
  isOpen: (value: string | undefined) => boolean;
  toggle: (value: string | undefined) => void;
}
const useCollapseGroup = defineInjectable<CollapseGroupState | null>(() => null);

export type CollapseGroupProps =
  & Define.Prop<'class', string, false>
  // Two-way binding: the `value` of the currently-open item (or undefined for
  // all-closed). `defaultValue` seeds the uncontrolled case.
  & Define.Prop<'defaultValue', string, false>
  // `undefined` is a valid value — "all closed" — so the model is nullable.
  & Define.Model<string | undefined>
  & Define.Slot<'default'>;

const _CollapseGroup = component<CollapseGroupProps>(({ props, slots }) => {
  const internal = signal<string | undefined>(props.defaultValue);
  const openValue = () => (props.model ? props.model.value : internal.value);
  const setOpen = (v: string | undefined) => {
    if (props.model) props.model.value = v;
    else internal.value = v;
  };

  defineProvide(useCollapseGroup, () => ({
    isOpen: (value) => value != null && openValue() === value,
    toggle: (value) => setOpen(openValue() === value ? undefined : value),
  }));

  return () => (
    <view class={`collapse-group${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

export type CollapseProps =
  & Define.Prop<'title', string, false>
  & Define.Prop<'icon', CollapseIcon, false>
  // Identity within a `Collapse.Group` (required for accordion membership).
  & Define.Prop<'value', string, false>
  // Uncontrolled initial open state (standalone use).
  & Define.Prop<'defaultOpen', boolean, false>
  & Define.Prop<'class', string, false>
  // Two-way binding for standalone use: `model={() => state.open}`. Inside a
  // group the group's state wins; the `toggle` event still fires.
  & Define.Model<boolean>
  & Define.Event<'toggle', boolean>
  & Define.Slot<'default'>
  & Define.Slot<'title'>;

const _Collapse = component<CollapseProps>(({ props, emit, slots }) => {
  const group = useCollapseGroup();
  const internal = signal<boolean>(!!props.defaultOpen);

  const inGroup = () => group != null && props.value != null;
  const isOpen = () => {
    if (inGroup()) return group!.isOpen(props.value);
    if (props.model) return !!props.model.value;
    return internal.value;
  };
  const toggle = () => {
    const next = !isOpen();
    if (inGroup()) group!.toggle(props.value);
    else if (props.model) props.model.value = next;
    else internal.value = next;
    emit('toggle', next);
  };

  const getClasses = () => {
    const c = ['collapse'];
    const icon = props.icon ?? 'arrow';
    if (icon === 'arrow') c.push('collapse-arrow');
    else if (icon === 'plus') c.push('collapse-plus');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const open = isOpen();
    const icon = props.icon ?? 'arrow';

    return (
      <view class={`${getClasses()}${open ? ' collapse-open' : ''}`}>
        <Pressable
          class="collapse-title"
          pressedOpacity={PRESSED_OPACITY}
          longPressDuration={0}
          accessibility-element={true}
          accessibility-label={props.title ?? 'Toggle section'}
          accessibility-trait="button"
          onPress={toggle}
        >
          <view class="collapse-title-content">
            {slots.title
              ? slots.title()
              : (props.title ? <text class="collapse-title-text">{props.title}</text> : null)}
          </view>
          {icon === 'arrow' ? (
            <text class="collapse-indicator" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</text>
          ) : icon === 'plus' ? (
            <text class="collapse-indicator">{open ? '−' : '+'}</text>
          ) : null}
        </Pressable>
        {open ? <view class="collapse-content">{slots.default?.()}</view> : null}
      </view>
    );
  };
});

export const Collapse = compound(_Collapse, {
  Group: _CollapseGroup,
});
