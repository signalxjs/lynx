/**
 * Shared types for the `useAnimatedStyle` linkage.
 *
 * The MT-side mapper registry (in lynx-runtime-main) and the BG-side
 * `useAnimatedStyle` factory (in @sigx/lynx) both need agreement on the
 * param shape per built-in mapper name. This module is the single source of
 * truth — adding a new built-in mapper means an entry here AND a matching
 * implementation in lynx-runtime-main's `mtMappers` table.
 */

/**
 * Range-mapping params: linear interpolation from input domain to output range.
 * Available on `translateX`, `translateY`, `scale`, `opacity` as an alternative
 * to the linear `factor`/`offset` shape. Multi-stop ranges (length ≥ 2) work —
 * each segment is interpolated independently.
 *
 * `extrapolate`:
 *   - `'clamp'` (default): cap at endpoints when input is outside the range.
 *   - `'identity'`: extend linearly beyond the endpoints using the slope of
 *     the nearest segment.
 */
export interface RangeParams {
  inputRange: number[];
  outputRange: number[];
  extrapolate?: 'clamp' | 'identity';
}

/**
 * Param shapes per built-in mapper. Add an entry here AND a matching
 * implementation in lynx-runtime-main's `mtMappers` table to ship a new
 * built-in mapper.
 */
export interface MapperParams {
  /** translateX(value * factor)px — defaults: { factor: 1 }. Or range-map. */
  translateX: { factor?: number } | RangeParams;
  /** translateY(value * factor)px — defaults: { factor: 1 }. Or range-map. */
  translateY: { factor?: number } | RangeParams;
  /** translate(value.x * factorX, value.y * factorY)px — for 2D AVs. */
  translate: { factorX?: number; factorY?: number };
  /** scale(value + offset) — defaults: { offset: 0 }. Or range-map. */
  scale: { offset?: number } | RangeParams;
  /** scaleX(value + offset) — defaults: { offset: 0 }. Or range-map. Use for width-axis growth (e.g. a pill indicator) without re-laying out. */
  scaleX: { offset?: number } | RangeParams;
  /** scaleY(value + offset) — defaults: { offset: 0 }. Or range-map. */
  scaleY: { offset?: number } | RangeParams;
  /**
   * opacity = clamp01(value * factor + offset). Or range-map (output is
   * clamped to [0,1] after interpolation either way).
   */
  opacity: { factor?: number; offset?: number } | RangeParams;
  /** rotate(value)deg. */
  rotate: Record<string, never>;
  /**
   * width: (value * factor)px — defaults: { factor: 1 }. Or range-map.
   *
   * Animating intrinsic width *does* trigger layout each frame (transform-
   * only mappers like `scaleX` are cheaper). Use `width` when you need the
   * surrounding flex layout to reflow around the animated element — e.g.
   * a pill that pushes siblings apart — and `scaleX` otherwise.
   */
  width: { factor?: number } | RangeParams;
  /** height: (value * factor)px — defaults: { factor: 1 }. Or range-map. See `width` caveat. */
  height: { factor?: number } | RangeParams;
  /** padding-top: (value * factor)px — defaults: { factor: 1 }. Or range-map. */
  paddingTop: { factor?: number } | RangeParams;
  /** padding-right: (value * factor)px — defaults: { factor: 1 }. Or range-map. */
  paddingRight: { factor?: number } | RangeParams;
  /** padding-bottom: (value * factor)px — defaults: { factor: 1 }. Or range-map. */
  paddingBottom: { factor?: number } | RangeParams;
  /** padding-left: (value * factor)px — defaults: { factor: 1 }. Or range-map. */
  paddingLeft: { factor?: number } | RangeParams;
  /** margin-top: (value * factor)px — defaults: { factor: 1 }. Or range-map. */
  marginTop: { factor?: number } | RangeParams;
  /** margin-right: (value * factor)px — defaults: { factor: 1 }. Or range-map. */
  marginRight: { factor?: number } | RangeParams;
  /** margin-bottom: (value * factor)px — defaults: { factor: 1 }. Or range-map. */
  marginBottom: { factor?: number } | RangeParams;
  /** margin-left: (value * factor)px — defaults: { factor: 1 }. Or range-map. */
  marginLeft: { factor?: number } | RangeParams;
}

export type BuiltinMapperName = keyof MapperParams;

export type AnimatedStyleMapper<P = unknown> = (
  value: unknown,
  params?: P,
) => Record<string, string | number>;

/**
 * Params per built-in derived-value reducer (#710). A reducer combines the
 * current values of one or more source SharedValues into a single scalar,
 * recomputed on the MT whenever a source changes. Like mappers, reducers are
 * selected by NAME (a primitive the worklet/op layer ships trivially) rather
 * than by capturing a function.
 */
export interface DerivedReducerParams {
  /** max of all source values — e.g. a bar above `max(keyboardLift, sheetHeight)`. */
  max: undefined;
  /** min of all source values. */
  min: undefined;
  /** sum of all source values. */
  sum: undefined;
  /**
   * `sources[0] * factor + offset` (extra sources ignored) — defaults
   * `{ factor: 1, offset: 0 }`. Scales one SV, e.g. a 0..1 progress into px.
   */
  scale: { factor?: number; offset?: number } | undefined;
}

export type DerivedReducerName = keyof DerivedReducerParams;

/**
 * A derived-value reducer: folds the live source values into one scalar. Pure
 * — no captures, no thread crossing; runs on the MT each flush a source
 * changed.
 */
export type DerivedReducer<P = unknown> = (
  values: number[],
  params?: P,
) => number;
