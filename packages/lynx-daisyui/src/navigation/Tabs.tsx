import { component, compound, type Define } from '@sigx/lynx';

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
    <view class={`tabs${props.class ? ' ' + props.class : ''}`}>
      {slots.default?.()}
    </view>
  );
});

const Tab = component<TabProps>(({ props, slots }) => {
  return () => {
    const isActive = props.active ?? false;

    return (
      <view
        class={`tab${isActive ? ' tab-active' : ''}${props.class ? ' ' + props.class : ''}`}
        bindtap={() => {
          props.onPress?.();
        }}
      >
        {slots.default?.()}
        {props.label ? <text>{props.label}</text> : null}
      </view>
    );
  };
});

export const Tabs = compound(_Tabs, {
  Tab,
});
