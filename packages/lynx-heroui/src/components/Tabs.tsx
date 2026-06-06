import { component, compound, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY } from '@sigx/lynx-zero';

export type TabsProps =
  & Define.Prop<'activeTab', string, false>
  & Define.Prop<'onChange', (value: string) => void, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export type TabProps =
  & Define.Prop<'value', string>
  & Define.Prop<'label', string, false>
  & Define.Prop<'active', boolean, false>
  & Define.Prop<'onPress', () => void, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

const _Tabs = component<TabsProps>(({ props, slots }) => {
  return () => (
    <view class={`hero-tabs${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

const Tab = component<TabProps>(({ props, slots }) => {
  return () => {
    const isActive = props.active ?? false;

    return (
      <Pressable
        class={`hero-tab${isActive ? ' hero-tab-active' : ''}${props.class ? ' ' + props.class : ''}`}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        onPress={() => {
          props.onPress?.();
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
