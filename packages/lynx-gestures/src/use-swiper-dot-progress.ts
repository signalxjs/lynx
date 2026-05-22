/**
 * Headless `<Swiper>` indicator hooks.
 *
 * `<Swiper>` writes the live scroll offset to a `SharedValue<number>` on
 * the MT thread every frame. To render an indicator the consumer needs
 * one binding per element so `useAnimatedStyle` has a stable call-site —
 * doing that inside `.map()` is fine (per-iteration call-sites are
 * stable across renders), but the bookkeeping (range math, ref alloc)
 * is fiddly and easy to get wrong.
 *
 * These hooks own the bookkeeping and return a `MainThreadRef` the
 * caller spreads onto any element they want animated. That keeps the
 * presentation in user-land (and in `@sigx/lynx-daisyui`'s themed
 * `SwiperIndicator`) while logic lives here.
 *
 * Layering pattern mirrors the daisyui split:
 *   - `@sigx/lynx-gestures` owns headless logic (this file + the
 *     `<Swiper>` component itself).
 *   - `@sigx/lynx-daisyui` ships themed `<SwiperIndicator>` variants
 *     that consume these hooks and pick colours from `ThemeProvider`.
 *
 * @example Custom dot using the opacity hook
 * ```tsx
 * function MyDot({ offset, pageWidth, index }) {
 *   const ref = useSwiperDotProgress({ offset, pageWidth, index });
 *   return (
 *     <view
 *       main-thread:ref={ref}
 *       style={{ width: '8px', height: '8px', borderRadius: '4px',
 *                backgroundColor: 'tomato', opacity: '0' }}
 *     />
 *   );
 * }
 * ```
 */
import {
  useAnimatedStyle,
  useMainThreadRef,
  type MainThread,
  type MainThreadRef,
  type SharedValue,
  type MapperParams,
} from '@sigx/lynx';

/** Common per-dot inputs — offset is page-pixel space, index is the dot's page. */
export interface SwiperDotHookInputs {
  /** Live MT-thread pixel offset from the Swiper's `offset` prop. */
  offset: SharedValue<number>;
  /** Page width in CSS pixels. Must match the Swiper's effective page width. */
  pageWidth: number;
  /** Zero-based page index this dot represents. */
  index: number;
}

export interface UseSwiperDotProgressOptions extends SwiperDotHookInputs {
  /**
   * Half-width of the input window in `pageWidth` units. The dot's
   * animation runs from `(index − window) * pageWidth` to
   * `(index + window) * pageWidth`. Default `1` — adjacent dots
   * crossfade because their windows overlap.
   */
  window?: number;
  /**
   * Output values at `[centre − window·pageWidth, centre, centre +
   * window·pageWidth]`. Default `[0, 1, 0]` (triangular). For "always
   * active" decoration use `[0, 1, 0]` with opacity; for "scale
   * pulse" pass e.g. `[1, 1.4, 1]` with channel `'scale'`.
   */
  outputRange?: readonly [number, number, number];
}

/**
 * Build a triangular range-map for the given dot index, defaulting to
 * the opacity crossfade `<SwiperDots>` shipped with previously. Returns
 * a `MainThreadRef` — spread it onto whatever element you want
 * animated.
 */
export function useSwiperDotProgress(
  opts: UseSwiperDotProgressOptions,
): MainThreadRef<MainThread.Element | null> {
  return useSwiperDotChannel({
    ...opts,
    channel: 'opacity',
    outputRange: opts.outputRange ?? [0, 1, 0],
  });
}

/**
 * Scale-pulse variant — active dot scales up, neighbours scale down to
 * the inactive baseline. Defaults: inactive `1`, active `1.4`.
 *
 * Uniform scale (both axes). For width-axis only growth (pill effect
 * that keeps the dot's height stable) use `useSwiperDotGrowX` instead.
 */
export function useSwiperDotScale(opts: SwiperDotHookInputs & {
  inactive?: number;
  active?: number;
  window?: number;
}): MainThreadRef<MainThread.Element | null> {
  const inactive = opts.inactive ?? 1;
  const active = opts.active ?? 1.4;
  return useSwiperDotChannel({
    offset: opts.offset,
    pageWidth: opts.pageWidth,
    index: opts.index,
    window: opts.window,
    channel: 'scale',
    outputRange: [inactive, active, inactive],
  });
}

/**
 * Width-axis growth — the active dot stretches into a pill, neighbours
 * shrink to a circle. Uses the `scaleX` channel, so the element's
 * intrinsic size in the layout stays put; only the visual width
 * changes. If you want surrounding siblings to physically shove apart
 * use `useSwiperDotWidth` instead (it animates the `width` style
 * property, which costs a layout pass each frame).
 */
export function useSwiperDotGrowX(opts: SwiperDotHookInputs & {
  /** Width multiplier when inactive. Default `1` (the dot's base size). */
  inactive?: number;
  /** Width multiplier when active. Default `3` (a pill ~3× as wide as tall). */
  active?: number;
  window?: number;
}): MainThreadRef<MainThread.Element | null> {
  const inactive = opts.inactive ?? 1;
  const active = opts.active ?? 3;
  return useSwiperDotChannel({
    offset: opts.offset,
    pageWidth: opts.pageWidth,
    index: opts.index,
    window: opts.window,
    channel: 'scaleX',
    outputRange: [inactive, active, inactive],
  });
}

/**
 * Layout-aware width growth — animates the element's `width` style in
 * px. Use this when sibling layout must respond (siblings flex away as
 * the pill grows). Slower than `useSwiperDotGrowX` because every frame
 * re-runs layout.
 *
 * Defaults shape an 8px → 24px pill.
 */
export function useSwiperDotWidth(opts: SwiperDotHookInputs & {
  /** Width in CSS pixels when inactive. Default `8`. */
  inactive?: number;
  /** Width in CSS pixels when active. Default `24`. */
  active?: number;
  window?: number;
}): MainThreadRef<MainThread.Element | null> {
  const inactive = opts.inactive ?? 8;
  const active = opts.active ?? 24;
  return useSwiperDotChannel({
    offset: opts.offset,
    pageWidth: opts.pageWidth,
    index: opts.index,
    window: opts.window,
    channel: 'width',
    outputRange: [inactive, active, inactive],
  });
}

/** Inputs for the track-wide translate hook used by the "bar" indicator variant. */
export interface UseSwiperDotTranslateOptions {
  offset: SharedValue<number>;
  /** Page width in CSS pixels. */
  pageWidth: number;
  /**
   * Distance in CSS pixels that one full page of scroll should move
   * the thumb by — typically `dotWidth + spacing` (the thumb steps to
   * the next dot's centre when the swiper advances by one page).
   */
  step: number;
}

/**
 * Translate a single "thumb" element across the indicator track,
 * proportional to the swiper's scroll progress. Use for the `bar`
 * variant where a single pill slides between fixed dots.
 */
export function useSwiperDotTranslate(
  opts: UseSwiperDotTranslateOptions,
): MainThreadRef<MainThread.Element | null> {
  const ref = useMainThreadRef<MainThread.Element | null>(null);
  // factor = step px per pageWidth px of offset. Guard against the
  // divide-by-zero before first layout — a factor of 0 just parks the
  // thumb at translateX(0), which is the correct initial position.
  const factor = opts.pageWidth > 0 ? opts.step / opts.pageWidth : 0;
  useAnimatedStyle(ref, opts.offset, 'translateX', { factor });
  return ref;
}

// ─────────────────────────────────────────────────────────────────────
// Internals

/**
 * Channels with `RangeParams` support that the indicator hooks use.
 * `width` / `height` run via the new layout-axis mappers; `scaleX` /
 * `scale` / `opacity` are transform/opacity-only.
 */
type RangeChannel = 'opacity' | 'scale' | 'scaleX' | 'scaleY' | 'translateX' | 'translateY' | 'width' | 'height';

interface ChannelOptions<N extends RangeChannel> extends SwiperDotHookInputs {
  channel: N;
  outputRange: readonly [number, number, number];
  window?: number;
}

function useSwiperDotChannel<N extends RangeChannel>(
  opts: ChannelOptions<N>,
): MainThreadRef<MainThread.Element | null> {
  const ref = useMainThreadRef<MainThread.Element | null>(null);
  // Guard against pre-layout pageWidth=0: collapsing the inputRange to
  // [0, 0, 0] would produce divide-by-zero / NaN in interpolateLinear.
  // Fall back to a non-degenerate window so the binding stays valid; once
  // layout settles and the parent re-renders with a real pageWidth, the
  // values flow through normally.
  const safePageWidth = opts.pageWidth > 0 ? opts.pageWidth : 1;
  const center = opts.index * safePageWidth;
  const w = (opts.window ?? 1) * safePageWidth;
  const params: MapperParams[N] = {
    inputRange: [center - w, center, center + w],
    outputRange: [opts.outputRange[0], opts.outputRange[1], opts.outputRange[2]],
    extrapolate: 'clamp',
  } as MapperParams[N];
  useAnimatedStyle(ref, opts.offset, opts.channel, params);
  return ref;
}
