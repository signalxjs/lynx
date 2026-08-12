import { component, useWidthClass, type Define } from '@sigx/lynx';
import type { BackgroundValue } from '../contract.js';
import { resolveResponsive, type Responsive } from '../shared/responsive.js';
import { type SpacingValue, resolveBoxStyle } from '../shared/styles.js';

/** Main-axis direction. `<Row>` defaults to `'row'`, `<Col>` to `'column'`. */
export type FlexDirection = 'row' | 'column';

export type RowProps =
  /**
   * Override the main axis, per breakpoint (#1013). The point is the
   * stack-on-phone / side-by-side-on-tablet flip: writing that as
   * `{wide ? <Row/> : <Col/>}` swaps the component type and **remounts the
   * whole subtree** on every rotation, losing child state and rebuilding.
   * `direction={{ initial: 'column', expanded: 'row' }}` restyles in place.
   */
  & Define.Prop<'direction', Responsive<FlexDirection>, false>
  & Define.Prop<'gap', Responsive<number>, false>
  & Define.Prop<'align', Responsive<'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline'>, false>
  & Define.Prop<'justify', Responsive<'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'>, false>
  & Define.Prop<'wrap', Responsive<boolean>, false>
  & Define.Prop<'padding', Responsive<SpacingValue>, false>
  & Define.Prop<'margin', Responsive<SpacingValue>, false>
  & Define.Prop<'width', Responsive<number | string>, false>
  & Define.Prop<'height', Responsive<number | string>, false>
  & Define.Prop<'flex', Responsive<number>, false>
  & Define.Prop<'background', Responsive<BackgroundValue>, false>
  & Define.Prop<'borderRadius', Responsive<number>, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>;

export const Row = component<RowProps>(({ props, slots }) => {
  // Singleton `Computed` from core — read inside the style closure below, which
  // already re-runs per render, so a breakpoint crossing restyles in place.
  const widthClass = useWidthClass();

  const getStyle = (): Record<string, string | number> => {
    const cls = widthClass.value;
    const style: Record<string, string | number> = {
      display: 'flex',
      flexDirection: resolveResponsive(props.direction, cls) ?? 'row',
    };

    const gap = resolveResponsive(props.gap, cls);
    const align = resolveResponsive(props.align, cls);
    const justify = resolveResponsive(props.justify, cls);
    const wrap = resolveResponsive(props.wrap, cls);

    if (gap !== undefined) style.gap = gap;
    if (align) style.alignItems = align;
    if (justify) style.justifyContent = justify;
    if (wrap) style.flexWrap = 'wrap';

    const box = resolveBoxStyle({
      width: props.width,
      height: props.height,
      flex: props.flex,
      background: props.background,
      borderRadius: props.borderRadius,
      padding: props.padding,
      margin: props.margin,
    }, cls);
    for (const key in box) {
      style[key] = box[key] as string | number;
    }

    return style;
  };

  return () => (
    <view class={props.class} style={getStyle()}>
      {slots.default?.()}
    </view>
  );
});
