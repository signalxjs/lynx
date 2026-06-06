import { component, type Define } from '@sigx/lynx';
import type { ColorVariant } from '@sigx/lynx-zero';

export type TextSize = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
export type TextWeight = 'light' | 'normal' | 'medium' | 'semibold' | 'bold';
export type TextColor = 'base-content' | Exclude<ColorVariant, 'neutral'>;

export type TextProps =
  & Define.Prop<'size', TextSize, false>
  & Define.Prop<'weight', TextWeight, false>
  & Define.Prop<'color', TextColor, false>
  & Define.Prop<'class', string, false>
  /**
   * Allow native text selection. Maps to Lynx's `text-selection` attribute
   * and sets `flatten={false}` (required by Lynx for selection to work).
   */
  & Define.Prop<'selectable', boolean, false>
  & Define.Slot<'default'>;

// hero-prefixed type ramp — the classes read the shared `--text-*` tokens
// (styles/components/typography.css), so `fontScale` and theme size
// overrides apply identically to both design systems.
const sizeClasses: Record<TextSize, string> = {
  xs: 'hero-text-xs', sm: 'hero-text-sm', base: 'hero-text-base', lg: 'hero-text-lg',
  xl: 'hero-text-xl', '2xl': 'hero-text-2xl', '3xl': 'hero-text-3xl',
};

const weightClasses: Record<TextWeight, string> = {
  light: 'hero-font-light', normal: 'hero-font-normal', medium: 'hero-font-medium',
  semibold: 'hero-font-semibold', bold: 'hero-font-bold',
};

export const Text = component<TextProps>(({ props, slots }) => {
  const getClasses = () => {
    const c: string[] = [sizeClasses[props.size ?? 'base']];
    if (props.weight) c.push(weightClasses[props.weight]);
    if (props.color) c.push(`hero-text-${props.color}`);
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => (
    <text
      class={getClasses()}
      text-selection={props.selectable}
      flatten={props.selectable ? false : undefined}
    >
      {slots.default?.()}
    </text>
  );
});
