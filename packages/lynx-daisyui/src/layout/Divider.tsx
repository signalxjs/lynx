import { component, type Define } from '@sigx/lynx';

export type DividerProps =
  & Define.Prop<'vertical', boolean, false>
  & Define.Prop<'color', string, false>
  & Define.Prop<'margin', number, false>
  & Define.Prop<'class', string, false>;

export const Divider = component<DividerProps>(({ props }) => {
  const getClasses = () => {
    const c = [props.vertical ? 'divider-vertical' : 'divider'];
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  const getStyle = (): Record<string, string | number> => {
    const style: Record<string, string | number> = {};
    if (props.color) style.backgroundColor = props.color;
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

  return () => (
    <view class={getClasses()} style={getStyle()} />
  );
});
