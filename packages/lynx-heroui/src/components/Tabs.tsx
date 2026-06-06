import { component, compound, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import {
  PRESSED_SCALE,
  PRESSED_OPACITY,
  provideTabsSelection,
  useTabsSelection,
} from '@sigx/lynx-zero';

export type TabsProps =
  & Define.Prop<'activeTab', string, false>
  & Define.Prop<'onChange', (value: string) => void, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export type TabProps =
  & Define.Prop<'value', string, true>
  /** Explicit override — when set, wins over the container's `activeTab`. */
  & Define.Prop<'active', boolean, false>
  & Define.Prop<'label', string, false>
  /** Pressed in addition to the container's `onChange`. */
  & Define.Prop<'onPress', () => void, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const _Tabs = component<TabsProps>(({ props, slots }) => {
  // Container-driven selection (headless, from @sigx/lynx-zero): tabs derive
  // their active state from `activeTab` and presses report through
  // `onChange`. Per-tab `active`/`onPress` overrides still win.
  provideTabsSelection(
    () => props.activeTab,
    (value) => props.onChange?.(value),
  );

  return () => (
    <view class={`hero-tabs${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

const Tab = component<TabProps>(({ props, slots }) => {
  const selection = useTabsSelection();

  return () => {
    const isActive = props.active ?? selection.isActive(props.value);

    return (
      <Pressable
        class={`hero-tab${isActive ? ' hero-tab-active' : ''}${props.class ? ' ' + props.class : ''}`}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        onPress={() => {
          props.onPress?.();
          selection.select(props.value);
        }}
      >
        {slots.default?.()}
        {props.label ? <text class="hero-tab-label">{props.label}</text> : null}
      </Pressable>
    );
  };
});

export const Tabs = compound(_Tabs, {
  Tab,
});
