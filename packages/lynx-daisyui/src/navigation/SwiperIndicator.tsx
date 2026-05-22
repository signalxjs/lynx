import {
  component,
  effect,
  signal,
  type Define,
  type PrimitiveSignal,
  type SharedValue,
} from '@sigx/lynx';
import {
  useSwiperDotProgress,
  useSwiperDotScale,
  useSwiperDotGrowX,
  useSwiperDotTranslate,
} from '@sigx/lynx-gestures';
import { resolveDaisyColor, type DaisyColor } from '../shared/styles.js';

/**
 * Visual style for the swiper page indicator.
 *
 * - `dots` — equally-spaced circles, the active one fades in via opacity.
 *   Today's default. Cheap (opacity-only MT mapper, no layout each frame).
 * - `bar` — fixed track with a single sliding thumb. Single MT binding
 *   regardless of page count, so cheapest for very long carousels.
 * - `pill` — the active dot stretches horizontally into a pill while
 *   neighbours stay circular. Uses `scaleX` so siblings don't reflow.
 * - `numbered` — text counter like `2 / 5`. Pure BG-thread, no animation.
 * - `scale-pulse` — circles where the active one scales up. No colour
 *   crossfade — pairs well with monochrome palettes.
 */
export type SwiperIndicatorVariant =
  | 'dots'
  | 'bar'
  | 'pill'
  | 'numbered'
  | 'scale-pulse';

export type SwiperIndicatorSize = 'xs' | 'sm' | 'md' | 'lg';

interface SizeSpec {
  /** Dot diameter in px. */
  dot: number;
  /** Gap between dots in px. */
  gap: number;
  /** Bar track height in px. */
  barHeight: number;
  /** Numbered variant font size in px. */
  fontSize: number;
}

const SIZE_TABLE: Record<SwiperIndicatorSize, SizeSpec> = {
  xs: { dot: 4, gap: 4, barHeight: 3, fontSize: 11 },
  sm: { dot: 6, gap: 6, barHeight: 4, fontSize: 12 },
  md: { dot: 8, gap: 8, barHeight: 5, fontSize: 14 },
  lg: { dot: 12, gap: 10, barHeight: 6, fontSize: 16 },
};

export type SwiperIndicatorProps =
  & Define.Prop<'variant', SwiperIndicatorVariant, false>
  /** Live MT pixel offset from the parent `<Swiper>`. Required for all animated variants. */
  & Define.Prop<'offset', SharedValue<number>, false>
  /** Page width in CSS px. Must match the Swiper's effective page width. */
  & Define.Prop<'pageWidth', number, false>
  /** Total page count. */
  & Define.Prop<'count', number, true>
  /**
   * Current page (whole-units). Required for `numbered`, used by `bar`
   * as fallback when `offset` isn't wired, and consumed by all variants
   * for tap-to-jump.
   */
  & Define.Prop<'index', PrimitiveSignal<number>, false>
  & Define.Prop<'color', DaisyColor, false>
  & Define.Prop<'inactiveColor', DaisyColor, false>
  & Define.Prop<'size', SwiperIndicatorSize, false>
  /**
   * Tap-to-jump handler. The receiver should typically write
   * `index.value = i` to glide the swiper to that page.
   */
  & Define.Prop<'onDotPress', (index: number) => void, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>;

/**
 * Themed swiper page indicator with five preset variants. Each variant
 * is a thin shell over a headless hook from `@sigx/lynx-gestures` (see
 * `useSwiperDotProgress`, `useSwiperDotScale`, `useSwiperDotGrowX`,
 * `useSwiperDotTranslate`). For a fully custom indicator, compose the
 * hooks yourself rather than forking this file.
 *
 * @example
 * ```tsx
 * const offset = useSharedValue(0);
 * const idx = signal({ value: 0 });
 * <Swiper offset={offset} index={idx} width={W}>…</Swiper>
 * <SwiperIndicator
 *   variant="pill"
 *   offset={offset}
 *   pageWidth={W}
 *   count={photos.length}
 *   index={idx}
 *   color="primary"
 *   onDotPress={(i) => { idx.value = i; }}
 * />
 * ```
 */
export const SwiperIndicator = component<SwiperIndicatorProps>(({ props }) => {
  return () => {
    const variant: SwiperIndicatorVariant = props.variant ?? 'dots';
    const size = SIZE_TABLE[props.size ?? 'md'];
    const activeColor = resolveDaisyColor(props.color ?? 'primary');
    const inactiveColor = resolveDaisyColor(props.inactiveColor ?? 'base-content');

    if (variant === 'numbered') {
      return (
        <NumberedIndicator
          count={props.count}
          index={props.index ?? FALLBACK_INDEX}
          color={activeColor}
          fontSize={size.fontSize}
          class={props.class}
          style={props.style}
        />
      );
    }

    if (variant === 'bar') {
      if (props.offset == null || props.pageWidth == null) return null;
      return (
        <BarIndicator
          offset={props.offset}
          pageWidth={props.pageWidth}
          count={props.count}
          activeColor={activeColor}
          inactiveColor={inactiveColor}
          barHeight={size.barHeight}
          dotSize={size.dot}
          gap={size.gap}
          onDotPress={props.onDotPress}
          class={props.class}
          style={props.style}
        />
      );
    }

    if (props.offset == null || props.pageWidth == null) return null;
    return (
      <view
        class={props.class}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: size.gap + 'px',
          ...(props.style || {}),
        }}
      >
        {Array.from({ length: props.count }, (_, i) => (
          <Dot
            key={i}
            index={i}
            offset={props.offset!}
            pageWidth={props.pageWidth!}
            variant={variant}
            size={size}
            activeColor={activeColor}
            inactiveColor={inactiveColor}
            onPress={props.onDotPress}
          />
        ))}
      </view>
    );
  };
});

// ─────────────────────────────────────────────────────────────────────
// Per-variant pieces. Each owns a single `useAnimatedStyle` call-site
// (per-iteration call inside `.map()` is fine — call-sites are stable).

const FALLBACK_INDEX: PrimitiveSignal<number> = signal({ value: 0 });

type DotProps =
  & Define.Prop<'index', number, true>
  & Define.Prop<'offset', SharedValue<number>, true>
  & Define.Prop<'pageWidth', number, true>
  & Define.Prop<'variant', Exclude<SwiperIndicatorVariant, 'numbered' | 'bar'>, true>
  & Define.Prop<'size', SizeSpec, true>
  & Define.Prop<'activeColor', string, true>
  & Define.Prop<'inactiveColor', string, true>
  & Define.Prop<'onPress', (index: number) => void, false>;

type ResolvedDotProps = {
  index: number;
  offset: SharedValue<number>;
  pageWidth: number;
  variant: Exclude<SwiperIndicatorVariant, 'numbered' | 'bar'>;
  size: SizeSpec;
  activeColor: string;
  inactiveColor: string;
  onPress?: (index: number) => void;
};

const Dot = component<DotProps>(({ props }) => {
  // Each branch picks a different headless hook. Variants that need
  // *two* simultaneous channels (opacity AND scale, or scale AND scaleX)
  // need two refs — one per element — because `useAnimatedStyle` is
  // one-binding-per-element.
  if (props.variant === 'dots') {
    return DotsBody(props);
  }
  if (props.variant === 'pill') {
    return PillBody(props);
  }
  // scale-pulse
  return ScalePulseBody(props);
});

function DotsBody(props: ResolvedDotProps) {
  const overlayRef = useSwiperDotProgress({
    offset: props.offset,
    pageWidth: props.pageWidth,
    index: props.index,
  });
  return () => (
    <view
      catchtap={props.onPress ? () => props.onPress?.(props.index) : undefined}
      style={{
        width: props.size.dot + 'px',
        height: props.size.dot + 'px',
        borderRadius: (props.size.dot / 2) + 'px',
        backgroundColor: withAlpha(props.inactiveColor, 0.4),
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <view
        main-thread:ref={overlayRef}
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          right: '0',
          bottom: '0',
          backgroundColor: props.activeColor,
          opacity: '0',
        }}
      />
    </view>
  );
}

function PillBody(props: ResolvedDotProps) {
  // Pill stretches horizontally via scaleX (no layout cost) and brightens
  // via opacity on the active-colour overlay. Both channels target the
  // same dot — but each needs its own bound element, so we wrap the
  // overlay inside a scaling shell.
  const shellRef = useSwiperDotGrowX({
    offset: props.offset,
    pageWidth: props.pageWidth,
    index: props.index,
    inactive: 1,
    active: 3,
  });
  const overlayRef = useSwiperDotProgress({
    offset: props.offset,
    pageWidth: props.pageWidth,
    index: props.index,
  });
  return () => (
    <view
      catchtap={props.onPress ? () => props.onPress?.(props.index) : undefined}
      main-thread:ref={shellRef}
      style={{
        width: props.size.dot + 'px',
        height: props.size.dot + 'px',
        borderRadius: (props.size.dot / 2) + 'px',
        backgroundColor: withAlpha(props.inactiveColor, 0.4),
        position: 'relative',
        overflow: 'hidden',
        transformOrigin: 'center center',
      }}
    >
      <view
        main-thread:ref={overlayRef}
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          right: '0',
          bottom: '0',
          backgroundColor: props.activeColor,
          opacity: '0',
        }}
      />
    </view>
  );
}

function ScalePulseBody(props: ResolvedDotProps) {
  // No colour crossfade — pure scale. Active dot uses `activeColor`,
  // inactive uses `inactiveColor` at low alpha. Visual is monochrome
  // friendly.
  const scaleRef = useSwiperDotScale({
    offset: props.offset,
    pageWidth: props.pageWidth,
    index: props.index,
    inactive: 1,
    active: 1.6,
  });
  const opacityRef = useSwiperDotProgress({
    offset: props.offset,
    pageWidth: props.pageWidth,
    index: props.index,
  });
  return () => (
    <view
      catchtap={props.onPress ? () => props.onPress?.(props.index) : undefined}
      main-thread:ref={scaleRef}
      style={{
        width: props.size.dot + 'px',
        height: props.size.dot + 'px',
        borderRadius: (props.size.dot / 2) + 'px',
        backgroundColor: withAlpha(props.inactiveColor, 0.4),
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <view
        main-thread:ref={opacityRef}
        style={{
          position: 'absolute',
          left: '0',
          top: '0',
          right: '0',
          bottom: '0',
          backgroundColor: props.activeColor,
          opacity: '0',
        }}
      />
    </view>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Bar variant — one sliding thumb across a fixed track.

type BarProps =
  & Define.Prop<'offset', SharedValue<number>, true>
  & Define.Prop<'pageWidth', number, true>
  & Define.Prop<'count', number, true>
  & Define.Prop<'activeColor', string, true>
  & Define.Prop<'inactiveColor', string, true>
  & Define.Prop<'barHeight', number, true>
  & Define.Prop<'dotSize', number, true>
  & Define.Prop<'gap', number, true>
  & Define.Prop<'onDotPress', (index: number) => void, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>;

const BarIndicator = component<BarProps>(({ props }) => {
  // The thumb advances by (dot + gap) per page. We use the headless
  // translate hook — a single MT binding regardless of page count.
  const step = props.dotSize + props.gap;
  const thumbRef = useSwiperDotTranslate({
    offset: props.offset,
    pageWidth: props.pageWidth,
    step,
  });

  return () => {
    const trackWidth = props.count * props.dotSize + Math.max(0, props.count - 1) * props.gap;
    return (
      <view
        class={props.class}
        style={{
          position: 'relative',
          width: trackWidth + 'px',
          height: props.barHeight + 'px',
          borderRadius: (props.barHeight / 2) + 'px',
          backgroundColor: withAlpha(props.inactiveColor, 0.25),
          overflow: 'visible',
          ...(props.style || {}),
        }}
      >
        {props.onDotPress
          ? (
            <view
              style={{
                position: 'absolute',
                inset: '0',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              {Array.from({ length: props.count }, (_, i) => (
                <view
                  key={i}
                  catchtap={() => props.onDotPress?.(i)}
                  style={{
                    width: (props.dotSize + props.gap) + 'px',
                    height: '100%',
                  }}
                />
              ))}
            </view>
          )
          : null}
        <view
          main-thread:ref={thumbRef}
          style={{
            position: 'absolute',
            left: '0',
            top: '0',
            width: props.dotSize + 'px',
            height: '100%',
            borderRadius: (props.barHeight / 2) + 'px',
            backgroundColor: props.activeColor,
          }}
        />
      </view>
    );
  };
});

// ─────────────────────────────────────────────────────────────────────
// Numbered variant — pure BG-thread.

type NumberedProps =
  & Define.Prop<'count', number, true>
  & Define.Prop<'index', PrimitiveSignal<number>, true>
  & Define.Prop<'color', string, true>
  & Define.Prop<'fontSize', number, true>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>;

const NumberedIndicator = component<NumberedProps>(({ props }) => {
  const label = signal({ value: '' });
  effect(() => {
    label.value = `${(props.index.value | 0) + 1} / ${props.count}`;
  });
  return () => (
    <text
      class={props.class}
      style={{
        color: props.color,
        fontSize: props.fontSize + 'px',
        fontWeight: '600',
        ...(props.style || {}),
      }}
    >
      {label.value}
    </text>
  );
});

// ─────────────────────────────────────────────────────────────────────
// Helpers

/**
 * Apply an alpha to a CSS colour value. Works for `var(--color-*)`
 * (uses `color-mix`) and for raw rgb/hex strings (uses `color-mix`
 * too — broadly supported on the platforms Lynx targets).
 */
function withAlpha(color: string, alpha: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, alpha)) * 100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
