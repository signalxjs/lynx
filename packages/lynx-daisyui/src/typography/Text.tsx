import { component, type Define } from '@sigx/lynx';

export type TextSize = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
export type TextWeight = 'light' | 'normal' | 'medium' | 'semibold' | 'bold';
export type TextColor = 'base-content' | 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error';

export type TextProps =
  & Define.Prop<'size', TextSize, false>
  & Define.Prop<'weight', TextWeight, false>
  & Define.Prop<'color', TextColor, false>
  & Define.Prop<'class', string, false>
  /**
   * Allow native text selection (long-press to select, system copy menu).
   * Maps to Lynx 3.7+'s `text-selection` attribute.
   */
  & Define.Prop<'selectable', boolean, false>
  /**
   * When `selectable` is enabled, suppress the system context menu so the
   * app can render its own. Maps to Lynx 3.7+'s `custom-text-selection`.
   */
  & Define.Prop<'customSelection', boolean, false>
  & Define.Slot<'default'>;

const sizeClasses: Record<TextSize, string> = {
  xs: 'text-xs', sm: 'text-sm', base: 'text-base', lg: 'text-lg',
  xl: 'text-xl', '2xl': 'text-2xl', '3xl': 'text-3xl',
};

const weightClasses: Record<TextWeight, string> = {
  light: 'font-light', normal: 'font-normal', medium: 'font-medium',
  semibold: 'font-semibold', bold: 'font-bold',
};

export const Text = component<TextProps>(({ props, slots }) => {
  const getClasses = () => {
    const c: string[] = [];
    if (props.size) c.push(sizeClasses[props.size]);
    if (props.weight) c.push(weightClasses[props.weight]);
    if (props.color) c.push(`text-${props.color}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => (
    <text
      class={getClasses()}
      text-selection={props.selectable}
      custom-text-selection={props.customSelection}
    >
      {slots.default?.()}
    </text>
  );
});
