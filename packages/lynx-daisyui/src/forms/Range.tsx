import {
  component,
  useMainThreadRef,
  runOnBackground,
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
  // Two-way binding (the sigx way): `model={() => state.volume}`. Dragging or
  // tapping the track writes the mapped value into the model; the static
  // `value` prop + `change` event still work when no model is bound.
  & Define.Model<number>
  & Define.Event<'change', number>;

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;

// Track frame measured on the main thread (page-relative left + pixel width).
interface TrackFrame {
  left: number;
  width: number;
}

export const Range = component<RangeProps>(({ props, emit }) => {
  const trackRef = useMainThreadRef<MainThread.Element | null>(null);
  const frame = useMainThreadRef<TrackFrame>({ left: 0, width: 0 });

  // Captured at setup — min/max/step rarely change and the gesture worklet
  // deep-copies its closure once. `disabled` is re-read live via the ref guard.
  const min = props.min ?? DEFAULT_MIN;
  const max = props.max ?? DEFAULT_MAX;
  const step = props.step ?? 1;
  const span = max - min || 1;

  const current = () => {
    const raw = props.model ? (props.model.value ?? min) : (props.value ?? min);
    return Math.min(max, Math.max(min, raw));
  };

  // Percent of the track the value occupies (left→right). Drives both the fill
  // width and the thumb offset purely from the model — no measurement needed
  // to *render*, only to interpret a touch.
  const percent = () => ((current() - min) / span) * 100;

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
  // the background-thread model. Runs inside a main-thread worklet.
  const commitFromPageX = (pageX: number) => {
    'main thread';
    const f = frame.current;
    if (!f || f.width <= 0) return;
    let frac = (pageX - f.left) / f.width;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    let v = min + frac * span;
    v = Math.round(v / step) * step;
    if (v < min) v = min;
    if (v > max) v = max;
    runOnBackground((next: number) => {
      if (props.model) props.model.value = next;
      emit('change', next);
    })(v);
  };

  const measureThen = (pageX: number) => {
    'main thread';
    const el = trackRef.current;
    const rp = el ? (el.invoke('boundingClientRect', {}) as unknown) : null;
    if (rp && typeof (rp as Promise<unknown>).then === 'function') {
      (rp as Promise<TrackFrame>)
        .then((r: TrackFrame | null) => {
          if (r) {
            frame.current.left = r.left;
            frame.current.width = r.width;
          }
          commitFromPageX(pageX);
        })
        .catch(() => {});
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
      if (props.disabled) return;
      const p = e && e.params;
      const pageX = (p && p.pageX) || 0;
      // Re-measure the track each interaction (cheap; handles scroll/rotate).
      measureThen(pageX);
    })
    .onUpdate((e: any) => {
      'main thread';
      if (props.disabled) return;
      const p = e && e.params;
      const pageX = (p && p.pageX) || 0;
      commitFromPageX(pageX);
    });

  useGestureDetector(trackRef, pan);

  return () => {
    const pct = percent();
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
