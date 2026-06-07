import { component, type Define } from '@sigx/lynx';

export type DividerProps =
  & Define.Prop<'vertical', boolean, false>
  & Define.Prop<'margin', number, false>
  & Define.Prop<'class', string, false>
  /**
   * Optional label — with content the divider renders `line · label · line`
   * (two flanking lines around the centered slot); without it, a plain line.
   */
  & Define.Slot<'default'>;

export const Divider = component<DividerProps>(({ props, slots }) => {
  const getMarginStyle = (): Record<string, string | number> => {
    const style: Record<string, string | number> = {};
    if (props.margin !== undefined) {
      if (props.vertical) { style.marginLeft = props.margin; style.marginRight = props.margin; }
      else { style.marginTop = props.margin; style.marginBottom = props.margin; }
    }
    return style;
  };

  return () => {
    const lineClass = props.vertical ? 'hero-divider-vertical' : 'hero-divider';
    const label = slots.default?.() ?? [];

    if (label.length === 0) {
      return <view class={`${lineClass}${props.class ? ' ' + props.class : ''}`} style={getMarginStyle()} />;
    }

    return (
      <view
        class={props.class}
        style={{
          display: 'flex',
          flexDirection: props.vertical ? 'column' : 'row',
          alignItems: 'center',
          alignSelf: 'stretch',
          gap: 8,
          ...getMarginStyle(),
        }}
      >
        <view class={lineClass} style={{ flex: 1 }} />
        {label}
        <view class={lineClass} style={{ flex: 1 }} />
      </view>
    );
  };
});
