import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, useThemeColors, type ColorVariant } from '@sigx/lynx-zero';

export type RatingColor = Exclude<ColorVariant, 'neutral'>;
export type RatingSize = 'xs' | 'sm' | 'md' | 'lg';

export type RatingProps =
  & Define.Prop<'value', number, false>
  & Define.Prop<'max', number, false>
  & Define.Prop<'color', RatingColor, false>
  & Define.Prop<'size', RatingSize, false>
  & Define.Prop<'readOnly', boolean, false>
  & Define.Prop<'class', string, false>
  // Two-way binding (the sigx way): `model={() => state.stars}`. Tapping an icon
  // writes its 1-based index into the model; an icon is filled when its index is
  // <= the value. The static `value` prop + `change` event still work when no
  // model is bound (controlled/showcase rows).
  & Define.Model<number>
  & Define.Event<'change', number>;

const DEFAULT_MAX = 5;
const FILLED = '★';
const EMPTY = '☆';

const glyphSizeMap: Record<RatingSize, number> = {
  xs: 14, sm: 18, md: 24, lg: 30,
};

export const Rating = component<RatingProps>(({ props, emit }) => {
  const colors = useThemeColors();

  const current = () => (props.model ? (props.model.value ?? 0) : (props.value ?? 0));
  const max = () => props.max ?? DEFAULT_MAX;

  const getClasses = () => {
    const c = ['rating'];
    const size = props.size ?? 'md';
    if (size !== 'md') c.push(`rating-${size}`);
    if (props.color) c.push(`rating-${props.color}`);
    if (props.readOnly) c.push('rating-readonly');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  return () => {
    const size = props.size ?? 'md';
    const fontSize = glyphSizeMap[size];
    const filledColor = colors.colorOf(props.color ?? 'warning');
    const emptyColor = colors.colorOf('base-300');
    const selected = current();
    const readOnly = !!props.readOnly;

    const icons = [];
    for (let i = 1; i <= max(); i++) {
      const filled = i <= selected;
      const glyphStyle = {
        fontSize,
        color: filled ? filledColor : emptyColor,
      } as const;
      const className = filled ? 'rating-icon rating-icon-active' : 'rating-icon';

      if (readOnly) {
        icons.push(
          <text class={className} style={glyphStyle}>{filled ? FILLED : EMPTY}</text>,
        );
      } else {
        const index = i;
        icons.push(
          <Pressable
            pressedScale={PRESSED_SCALE}
            pressedOpacity={PRESSED_OPACITY}
            longPressDuration={0}
            accessibility-element={true}
            accessibility-label={`Rate ${index}`}
            accessibility-trait="button"
            onPress={() => {
              const next = index;
              if (props.model) props.model.value = next;
              emit('change', next);
            }}
          >
            <text class={className} style={glyphStyle}>{filled ? FILLED : EMPTY}</text>
          </Pressable>,
        );
      }
    }

    return <view class={getClasses()}>{icons}</view>;
  };
});
