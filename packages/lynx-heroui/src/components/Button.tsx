import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant, type SizeScale } from '@sigx/lynx-zero';

// The shared contract's color/variant split (signalxjs/lynx#219): `color` is
// the semantic color, `variant` is hero's fill style (upstream HeroUI's
// solid / bordered / flat / ghost). Defaults to solid like upstream.
export type ButtonColor = ColorVariant;
export type ButtonVariant = 'solid' | 'bordered' | 'flat' | 'ghost';
/** Hero's size scale is the sm–lg subset of the shared `SizeScale`. */
export type ButtonSize = Extract<SizeScale, 'sm' | 'md' | 'lg'>;

export type ButtonProps =
  & Define.Prop<'color', ButtonColor, false>
  & Define.Prop<'variant', ButtonVariant, false>
  & Define.Prop<'size', ButtonSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'loading', boolean, false>
  & Define.Prop<'block', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Slot<'default'>
  & Define.Event<'press', void>;

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'hero-btn-sm', md: '', lg: 'hero-btn-lg',
};

export const Button = component<ButtonProps>(({ props, slots, emit }) => {
  const getClasses = () => {
    const c = ['hero-btn'];
    c.push(`hero-btn-${props.color ?? 'neutral'}`);
    if (props.variant && props.variant !== 'solid') c.push(`hero-btn-${props.variant}`);
    if (props.size) { const s = sizeClasses[props.size]; if (s) c.push(s); }
    if (props.block) c.push('hero-btn-block');
    if (props.disabled || props.loading) c.push('hero-btn-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const inert = !!(props.disabled || props.loading);
    return (
      <Pressable
        class={getClasses()}
        disabled={inert}
        pressedScale={PRESSED_SCALE}
        pressedOpacity={PRESSED_OPACITY}
        longPressDuration={0}
        onPress={() => { if (!inert) emit('press'); }}
      >
        {slots.default?.()}
      </Pressable>
    );
  };
});
