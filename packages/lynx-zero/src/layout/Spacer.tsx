import { component, type Define } from '@sigx/lynx';

export type SpacerProps =
  & Define.Prop<'size', number, false>
  & Define.Prop<'class', string, false>;

export const Spacer = component<SpacerProps>(({ props }) => {
  const getStyle = (): Record<string, string | number> => {
    if (props.size !== undefined) {
      return { width: props.size, height: props.size };
    }
    return { flex: 1 };
  };

  return () => (
    <view class={props.class} style={getStyle()} />
  );
});
