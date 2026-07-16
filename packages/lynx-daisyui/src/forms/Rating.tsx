import { component, type Define } from '@sigx/lynx';
import { Pressable } from '@sigx/lynx-gestures';
import { PRESSED_SCALE, PRESSED_OPACITY, type ColorVariant } from '@sigx/lynx-zero';

export type RatingColor = Exclude<ColorVariant, 'neutral'>;
export type RatingSize = 'xs' | 'sm' | 'md' | 'lg';

export type RatingProps =
  & Define.Prop<'value', number, false>
  & Define.Prop<'max', number, false>
  & Define.Prop<'color', RatingColor, false>
  & Define.Prop<'size', RatingSize, false>
  & Define.Prop<'readOnly', boolean, false>
  // Enable half-step ratings: the value can be in 0.5 increments and each icon
  // renders a left-half fill. Tapping the left/right half of an icon sets
  // `i - 0.5` / `i`. Off by default (integer-only).
  & Define.Prop<'allowHalf', boolean, false>
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
    const glyphStyle = { fontSize } as const;
    const selected = current();
    const readOnly = !!props.readOnly;
    const allowHalf = !!props.allowHalf;

    const setVal = (v: number) => {
      if (props.model) props.model.value = v;
      emit('change', v);
    };

    const icons = [];
    for (let i = 1; i <= max(); i++) {
      const full = selected >= i;
      const half = !full && allowHalf && selected >= i - 0.5;

      if (allowHalf) {
        // Layered cell: an empty (or full) base glyph, an optional left-half
        // clipped filled overlay, and two tap zones (left → i-0.5, right → i).
        const index = i;
        const layers = [
          <text class={full ? 'rating-icon rating-icon-active' : 'rating-icon'} style={glyphStyle}>
            {full ? FILLED : EMPTY}
          </text>,
        ];
        if (half) {
          layers.push(
            <view class="rating-half" style={{ width: fontSize / 2, height: fontSize }}>
              <text class="rating-icon rating-icon-active" style={glyphStyle}>{FILLED}</text>
            </view>,
          );
        }
        if (!readOnly) {
          layers.push(
            <Pressable
              class="rating-hit"
              longPressDuration={0}
              accessibility-element={true}
              accessibility-label={`Rate ${index - 0.5}`}
              accessibility-trait="button"
              style={{ left: 0, width: fontSize / 2, height: fontSize }}
              onPress={() => setVal(index - 0.5)}
            />,
            <Pressable
              class="rating-hit"
              longPressDuration={0}
              accessibility-element={true}
              accessibility-label={`Rate ${index}`}
              accessibility-trait="button"
              style={{ left: fontSize / 2, width: fontSize / 2, height: fontSize }}
              onPress={() => setVal(index)}
            />,
          );
        }
        icons.push(
          <view class="rating-star" style={{ width: fontSize, height: fontSize }}>
            {layers}
          </view>,
        );
      } else {
        // Integer mode: a single full-width tap target per icon.
        const className = full ? 'rating-icon rating-icon-active' : 'rating-icon';
        if (readOnly) {
          icons.push(
            <text class={className} style={glyphStyle}>{full ? FILLED : EMPTY}</text>,
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
              onPress={() => setVal(index)}
            >
              <text class={className} style={glyphStyle}>{full ? FILLED : EMPTY}</text>
            </Pressable>,
          );
        }
      }
    }

    return <view class={getClasses()}>{icons}</view>;
  };
});
