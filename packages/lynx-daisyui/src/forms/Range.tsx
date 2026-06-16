import {
  component,
  useMainThreadRef,
  runOnBackground,
  runOnMainThread,
  Gesture,
  useGestureDetector,
  type Define,
  type MainThread,
} from '@sigx/lynx';
import { type ColorVariant } from '@sigx/lynx-zero';

export type RangeColor = Exclude<ColorVariant, 'neutral'>;
export type RangeSize = 'xs' | 'sm' | 'md' | 'lg';

export type RangeProps =
  & Define.Prop<'value', number, false>
  & Define.Prop<'min', number, false>
  & Define.Prop<'max', number, false>
  & Define.Prop<'step', number, false>
  & Define.Prop<'color', RangeColor, false>
  & Define.Prop<'size', RangeSize, false>
  & Define.Prop<'disabled', boolean, false>
  & Define.Prop<'class', string, false>
  // Two-way binding (the sigx way): `model={() => state.volume}`. Dragging the
  // thumb writes the mapped value into the model; the static `value` prop +
  // `change` event still work when no model is bound.
  & Define.Model<number>
  & Define.Event<'change', number>;

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;

/**
 * Quantize a raw value to `step` (relative to `min`, so steps land on
 * min, min+step, … even when min isn't a multiple of step) and clamp to
 * [min, max]. `step <= 0` means continuous. Exported for testing; the gesture
 * worklet inlines the same math because Lynx worklets can't call imported
 * functions across the main-thread boundary.
 */
export function quantizeRangeValue(raw: number, min: number, max: number, step: number): number {
  let v = raw;
  if (step > 0) v = min + Math.round((v - min) / step) * step;
  if (v < min) v = min;
  if (v > max) v = max;
  return v;
}

// Normalized bounds for a set of props (min <= max even if inverted).
function boundsOf(props: { min?: number; max?: number; step?: number }) {
  const a = props.min ?? DEFAULT_MIN;
  const b = props.max ?? DEFAULT_MAX;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return { min, max, step: props.step ?? 1, span: (max - min) || 1 };
}

// Track frame measured on the main thread (page-relative left + pixel width)
// plus the last value bridged to BG, for MT-side dedup.
interface TrackFrame {
  left: number;
  width: number;
  lastV: number;
}

// Live config shipped BG→MT each render so the gesture respects post-mount
// changes to disabled/min/max/step (a captured closure would go stale).
interface RangeConfig {
  disabled: boolean;
  min: number;
  max: number;
  step: number;
}

export const Range = component<RangeProps>(({ props, emit }) => {
  const trackRef = useMainThreadRef<MainThread.Element | null>(null);
  const frame = useMainThreadRef<TrackFrame>({ left: 0, width: 0, lastV: Number.NaN });

  // Seed the MT-side config once; the render fn ships updates across via the
  // `syncConfig` worklet (BG-side `.current` writes don't reach MT — same
  // pattern Pressable uses for reactive `disabled`).
  const seed = boundsOf(props);
  const cfg = useMainThreadRef<RangeConfig>({
    disabled: !!props.disabled,
    min: seed.min,
    max: seed.max,
    step: seed.step,
  });
  const syncConfig = runOnMainThread((disabled: boolean, min: number, max: number, step: number) => {
    'main thread';
    cfg.current.disabled = disabled;
    cfg.current.min = min;
    cfg.current.max = max;
    cfg.current.step = step;
  });
  let lastCfgKey = '';

  const getClasses = () => {
    const c = ['range'];
    const size = props.size ?? 'md';
    if (size !== 'md') c.push(`range-${size}`);
    if (props.color) c.push(`range-${props.color}`);
    if (props.disabled) c.push('range-disabled');
    if (props.class) c.push(props.class);
    return c.join(' ');
  };

  // Map a page-X touch coordinate to a stepped, clamped value and commit it to
  // the background-thread model. Runs inside a main-thread worklet, reading the
  // live `cfg` (not a mount-time snapshot).
  const commitFromPageX = (pageX: number) => {
    'main thread';
    const f = frame.current;
    const c = cfg.current;
    if (!f || f.width <= 0) return;
    const span = (c.max - c.min) || 1;
    let frac = (pageX - f.left) / f.width;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    // Inlined `quantizeRangeValue` (worklets can't call imported fns).
    let v = c.min + frac * span;
    if (c.step > 0) v = c.min + Math.round((v - c.min) / c.step) * c.step;
    if (v < c.min) v = c.min;
    if (v > c.max) v = c.max;
    // MT-side dedup: only bridge to BG when the quantized value changes.
    if (v === f.lastV) return;
    f.lastV = v;
    runOnBackground((next: number) => {
      if (props.model) {
        if (props.model.value === next) return;
        props.model.value = next;
      }
      emit('change', next);
    })(v);
  };

  const measureThen = (pageX: number) => {
    'main thread';
    const el = trackRef.current;
    const rp = el ? (el.invoke('boundingClientRect', {}) as unknown) : null;
    if (rp && typeof (rp as Promise<unknown>).then === 'function') {
      (rp as Promise<{ left: number; width: number }>)
        .then((r) => {
          if (r) {
            frame.current.left = r.left;
            frame.current.width = r.width;
          }
          commitFromPageX(pageX);
        })
        // On measurement failure, still commit using the last-known frame
        // (a no-op only on the very first interaction, when width is still 0).
        .catch(() => {
          commitFromPageX(pageX);
        });
    } else {
      commitFromPageX(pageX);
    }
  };

  const pan = Gesture.Pan()
    .axis('x')
    .minDistance(0)
    // Empty onBegin gates iOS so onStart/onEnd fire (same quirk as Swipeable).
    .onBegin(() => {
      'main thread';
    })
    .onStart((e: any) => {
      'main thread';
      if (cfg.current.disabled) return;
      // Reset the dedup cache so the first frame of a new interaction commits
      // even if the value was changed externally since the last drag.
      frame.current.lastV = Number.NaN;
      const p = e && e.params;
      const pageX = (p && p.pageX) || 0;
      // Re-measure the track each interaction (cheap; handles scroll/rotate).
      measureThen(pageX);
    })
    .onUpdate((e: any) => {
      'main thread';
      if (cfg.current.disabled) return;
      const p = e && e.params;
      const pageX = (p && p.pageX) || 0;
      commitFromPageX(pageX);
    });

  useGestureDetector(trackRef, pan);

  return () => {
    // Ship the live config to the MT gesture when it changes.
    const b = boundsOf(props);
    const dis = !!props.disabled;
    const key = `${dis}|${b.min}|${b.max}|${b.step}`;
    if (key !== lastCfgKey) {
      lastCfgKey = key;
      void syncConfig(dis, b.min, b.max, b.step);
    }

    // Percent of the track the value occupies — rendered purely from the model
    // (or static `value`), reactive to min/max changes.
    const raw = props.model ? (props.model.value ?? b.min) : (props.value ?? b.min);
    const val = Math.min(b.max, Math.max(b.min, raw));
    const pct = ((val - b.min) / b.span) * 100;

    return (
      <view class={getClasses()} main-thread:ref={trackRef}>
        <view class="range-track">
          <view class="range-fill" style={{ width: `${pct}%` }} />
        </view>
        <view class="range-thumb" style={{ left: `${pct}%` }} />
      </view>
    );
  };
});
