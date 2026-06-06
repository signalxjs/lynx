import { component, type Define } from '@sigx/lynx';

export type DividerProps =
  & Define.Prop<'vertical', boolean, false>
  & Define.Prop<'color', string, false>
  & Define.Prop<'margin', number, false>
  & Define.Prop<'class', string, false>
  /**
   * Optional label (#212). With content the divider renders the daisyUI
   * `line · label · line` composition — two flanking lines with the slot
   * centered between them; without it, the plain single line (unchanged).
   */
  & Define.Slot<'default'>;

export const Divider = component<DividerProps>(({ props, slots }) => {
  const getClasses = () => {
    const c = [props.vertical ? 'divider-vertical' : 'divider'];
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  /** Margins from the `margin` prop — outer edges in both render modes. */
  const getMarginStyle = (): Record<string, string | number> => {
    const style: Record<string, string | number> = {};
    if (props.margin !== undefined) {
      if (props.vertical) {
        style.marginLeft = props.margin;
        style.marginRight = props.margin;
      } else {
        style.marginTop = props.margin;
        style.marginBottom = props.margin;
      }
    }
    return style;
  };

  const getStyle = (): Record<string, string | number> => {
    const style: Record<string, string | number> = getMarginStyle();
    if (props.color) style.backgroundColor = props.color;
    return style;
  };

  return () => {
    // `slots.default` always exists — presence of label content is the
    // returned children array being non-empty.
    const label = slots.default();
    if (label.length === 0) {
      return <view class={getClasses()} style={getStyle()} />;
    }

    // Labeled: the lines reuse the divider class (themed color/thickness),
    // flex-fill around the centered label. `color` tints the lines; the
    // label styles itself. `margin` and `class` land on the wrapper.
    const lineClass = props.vertical ? 'divider-vertical' : 'divider';
    const lineStyle: Record<string, string | number> = { flex: 1 };
    if (props.color) lineStyle.backgroundColor = props.color;
    return (
      <view
        class={props.class}
        style={{
          display: 'flex',
          flexDirection: props.vertical ? 'column' : 'row',
          alignItems: 'center',
          alignSelf: 'stretch',
          gap: '8px',
          ...getMarginStyle(),
        }}
      >
        <view class={lineClass} style={lineStyle} />
        {label}
        <view class={lineClass} style={lineStyle} />
      </view>
    );
  };
});
