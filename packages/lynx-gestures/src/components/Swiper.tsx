import {
  component,
  effect,
  runOnMainThread,
  signal,
  useElementLayout,
  useMainThreadRef,
  useSharedValue,
  type SharedValue,
  type Define,
  type MainThread,
} from '@sigx/lynx';
import type { PrimitiveSignal } from '@sigx/reactivity';

// Read the logical screen width once at module load — used as the page
// width fallback before the Swiper's own layout box has been measured.
// Matches the same `lynx.SystemInfo` reads used by lynx-navigation, so
// fullscreen / edge-to-edge layouts line up.
declare const lynx:
  | { SystemInfo?: { pixelWidth?: number; pixelHeight?: number; pixelRatio?: number } }
  | undefined;

const SCREEN_WIDTH_FALLBACK = (() => {
  try {
    const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
    const px = info?.pixelWidth;
    const pr = info?.pixelRatio || 1;
    if (typeof px === 'number' && px > 0) return Math.round(px / pr);
  } catch {
    /* ignore */
  }
  return 400;
})();

const SCREEN_HEIGHT_FALLBACK = (() => {
  try {
    const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
    const px = info?.pixelHeight;
    const pr = info?.pixelRatio || 1;
    if (typeof px === 'number' && px > 0) return Math.round(px / pr);
  } catch {
    /* ignore */
  }
  return 800;
})();

export type SwiperProps<T = unknown> =
  /**
   * The items to render — one page per item. Switched from slot-based
   * children because horizontal `<scroll-view>` children need explicit
   * pixel widths (Lynx doesn't resolve `width: 100%` against the viewport
   * in a horizontal scroller), so the Swiper has to own the page wrapper.
   */
  & Define.Prop<'items', readonly T[], true>
  /** Per-item renderer. Output is wrapped in a page-width sized `<view>`. */
  & Define.Prop<'renderItem', (item: T, index: number) => unknown, true>
  /** Optional key extractor — defaults to the item's array index. */
  & Define.Prop<'keyExtractor', (item: T, index: number) => string | number, false>
  /**
   * Page width in CSS pixels. Defaults to the Swiper's own measured
   * container width via `useElementLayout`, falling back to
   * `lynx.SystemInfo.pixelWidth / pixelRatio` before the first layout
   * pass.
   */
  & Define.Prop<'width', number, false>
  /** Page height in CSS pixels — applied to each page wrapper. */
  & Define.Prop<'height', number | string, false>
  /**
   * Externally-observable current page (whole units). Updated from
   * `bindscroll` as the user pans. Writes from outside (e.g.
   * `idx.value = 2`) glide the swiper to that page via the native
   * `<scroll-view>.scrollTo` UI method.
   */
  & Define.Prop<'index', PrimitiveSignal<number>, false>
  /** Page to render first (uncontrolled-initial). */
  & Define.Prop<'initialIndex', number, false>
  /**
   * MT-thread live pixel offset, updated every scroll frame from the
   * native scroll-view's `scrollLeft`.
   */
  & Define.Prop<'offset', SharedValue<number>, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  /** Emitted (BG) when the page-rounded `scrollLeft / width` changes. */
  & Define.Event<'pageChange', { index: number }>;

/**
 * Paged horizontal carousel built on Lynx's native `<scroll-view
 * paging-enabled>` — native snap, no MTS pan handling required for the
 * happy path. Items are rendered into page-sized `<view>` wrappers (the
 * Swiper owns the sizing so Lynx's horizontal scroller has explicit
 * widths to lay out against; `width: 100%` does NOT resolve to the
 * viewport for `<scroll-view scroll-orientation="horizontal">` children).
 *
 * @example
 * ```tsx
 * const idx = signal(0);
 * const offset = useSharedValue(0);
 * <Swiper
 *   items={photos}
 *   index={idx}
 *   offset={offset}
 *   renderItem={(src) => (
 *     <image src={src} mode="aspectFit" style={{ width: '100%', height: '100%' }} />
 *   )}
 * />
 * ```
 */
export const Swiper = component<SwiperProps>(({ props, emit }) => {
  const ownOffset = useSharedValue(0);
  const ownIndex = signal(props.initialIndex ?? 0);

  const { layout, onLayoutChange } = useElementLayout();
  const scrollRef = useMainThreadRef<MainThread.Element | null>(null);

  // Resolve the controlled-vs-uncontrolled signal/offset once at setup so the
  // BG→MT reactive bridge below and the render closure share the same instance.
  const offset = props.offset ?? ownOffset;
  const idx = props.index ?? ownIndex;

  // BG→MT bridge: when external code (or a dot tap) writes `idx.value = N`,
  // we invoke the native `<scroll-view>.scrollTo` UI method on MT so the
  // animation runs with platform physics (the same easing the user gets when
  // they fling-snap). The dedup runs MT-side against the live scroll offset
  // so we don't re-invoke for writes that just mirror a finished snap.
  const scrollOnMT = runOnMainThread((index: number, pageW: number) => {
    'main thread';
    const el = scrollRef.current;
    if (!el || pageW <= 0) return;
    const target = index * pageW;
    const current = offset.current.value;
    if (Math.abs(current - target) < 0.5) return;
    el.invoke('scrollTo', { index, smooth: true });
  });

  effect(() => {
    const v = idx.value;
    if (typeof v !== 'number') return;
    const pw = props.width
      ?? (layout.value && layout.value.width > 0 ? layout.value.width : undefined)
      ?? SCREEN_WIDTH_FALLBACK;
    scrollOnMT(v, pw);
  });

  return () => {
    const pageWidth = props.width
      ?? (layout.value && layout.value.width > 0 ? layout.value.width : undefined)
      ?? SCREEN_WIDTH_FALLBACK;
    // Lynx horizontal `<scroll-view>` doesn't resolve `height: 100%` on
    // children (same constraint as width), so the page wrapper needs a
    // pixel value. Use the measured layout height when available; the
    // screen-height fallback covers the first paint. Guard against the
    // `0 ?? fallback` gotcha — a zero-sized layout report (e.g. before
    // first paint) must fall through to the fallback.
    const measuredHeight = layout.value && layout.value.height > 0 ? layout.value.height : undefined;
    const pageHeight: number | string = props.height
      ?? measuredHeight
      ?? SCREEN_HEIGHT_FALLBACK;
    const initialScrollLeft = (props.initialIndex ?? 0) * pageWidth;
    const items = props.items;
    const keyOf = props.keyExtractor;
    return (
      <scroll-view
        main-thread:ref={scrollRef}
        scroll-orientation="horizontal"
        paging-enabled
        show-scrollbar={false}
        bounces={true}
        scroll-left={initialScrollLeft}
        class={props.class}
        style={{ width: '100%', ...(props.style || {}) }}
        bindlayoutchange={onLayoutChange}
        main-thread-bindscroll={(e: { detail: { scrollLeft: number } }) => {
          'main thread';
          offset.current.value = e.detail.scrollLeft;
          const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
          if (__flush) __flush();
        }}
        bindscroll={(e: { detail: { scrollLeft: number } }) => {
          if (pageWidth <= 0) return;
          const next = Math.round(e.detail.scrollLeft / pageWidth);
          if (next !== idx.value) {
            idx.value = next;
            emit('pageChange', { index: next });
          }
        }}
      >
        {items.map((item, i) => (
          <view
            key={keyOf ? String(keyOf(item, i)) : String(i)}
            style={{
              width: pageWidth + 'px',
              height: typeof pageHeight === 'number' ? pageHeight + 'px' : pageHeight,
              flexShrink: 0,
              flexGrow: 0,
            }}
          >
            {props.renderItem(item, i)}
          </view>
        ))}
      </scroll-view>
    );
  };
}) as <T>(props: SwiperProps<T>) => unknown;
