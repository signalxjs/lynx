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
// Decimal places implied by a step (0.1 → 1, 0.25 → 2, 2 → 0), used to strip
// floating-point drift from stepped values.
function stepDecimals(step: number): number {
  return (String(step).split('.')[1] || '').length;
}

export function quantizeRangeValue(raw: number, min: number, max: number, step: number): number {
  let v = raw;
  if (step > 0) {
    v = min + Math.round((v - min) / step) * step;
    // Strip floating-point drift (e.g. step 0.1 → 0.30000000000000004).
    const p = Math.pow(10, stepDecimals(step));
    v = Math.round(v * p) / p;
  }
  if (v < min) v = min;
  if (v > max) v = max;
  return v;
}

// Coerce to a finite number, falling back to a default for NaN/Infinity/non-numbers.
function finite(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

// Normalized bounds for a set of props (min <= max even if inverted; non-finite
// inputs fall back to defaults so NaN can't leak into the rendered % or model).
function boundsOf(props: { min?: number; max?: number; step?: number }) {
  const a = finite(props.min, DEFAULT_MIN);
  const b = finite(props.max, DEFAULT_MAX);
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  const step = finite(props.step, 1);
  return { min, max, step, span: (max - min) || 1, precision: Math.pow(10, stepDecimals(step)) };
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
  precision: number;
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
    precision: seed.precision,
  });
  const syncConfig = runOnMainThread((disabled: boolean, min: number, max: number, step: number, precision: number) => {
    'main thread';
    cfg.current.disabled = disabled;
    cfg.current.min = min;
    cfg.current.max = max;
    cfg.current.step = step;
    cfg.current.precision = precision;
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
    if (c.step > 0) {
      v = c.min + Math.round((v - c.min) / c.step) * c.step;
      // Strip FP drift so dedup stays exact and `%` strings don't get noisy.
      v = Math.round(v * c.precision) / c.precision;
    }
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
    // Small threshold so only an intentional drag activates — a stray tap or a
    // scroll gesture won't accidentally move the value (interaction is
    // drag-driven; tap-to-seek would be a separate Tap gesture follow-up).
    .minDistance(6)
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
      void syncConfig(dis, b.min, b.max, b.step, b.precision);
    }

    // Percent of the track the value occupies — rendered from the model (or
    // static `value`), reactive to min/max changes. Quantize/clamp the same way
    // the gesture does so an off-step or non-finite value can't show an
    // in-between thumb or a NaN% string.
    let raw = props.model ? (props.model.value ?? b.min) : (props.value ?? b.min);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) raw = b.min;
    const val = quantizeRangeValue(raw, b.min, b.max, b.step);
    const pct = ((val - b.min) / b.span) * 100;

    return (
      <view
        class={getClasses()}
        main-thread:ref={trackRef}
        accessibility-element={true}
        accessibility-label="Slider"
        accessibility-trait="adjustable"
      >
        <view class="range-track">
          <view class="range-fill" style={{ width: `${pct}%` }} />
        </view>
        <view class="range-thumb" style={{ left: `${pct}%` }} />
      </view>
    );
  };
});
