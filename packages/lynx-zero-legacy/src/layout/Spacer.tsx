import { component, useWidthClass, type Define } from '@sigx/lynx';
import { resolveResponsive, type Responsive } from '../shared/responsive.js';

export type SpacerProps =
  & Define.Prop<'size', Responsive<number>, false>
  & Define.Prop<'class', string, false>;

export const Spacer = component<SpacerProps>(({ props }) => {
  const widthClass = useWidthClass();

  const getStyle = (): Record<string, string | number> => {
    // A responsive `size` that resolves to nothing at the active breakpoint
    // (e.g. `{ expanded: 24 }` on a phone) falls through to the flexible
    // spacer, same as omitting the prop.
    const size = resolveResponsive(props.size, widthClass.value);
    if (size !== undefined) {
      return { width: size, height: size };
    }
    return { flex: 1 };
  };

  return () => (
    <view class={props.class} style={getStyle()} />
  );
});
