import {
  component,
  effect,
  signal,
  useElementLayout,
  useMainThreadRef,
  useSharedValue,
  useAnimatedStyle,
  runOnBackground,
  runOnMainThread,
  Gesture,
  useGestureDetector,
  type MainThread,
} from '@sigx/lynx';
import type { ListProps } from './types.js';

// Reserved item-keys for the optional header/footer/loading cells. Prefixed so
// they never collide with a consumer's keyExtractor output.
const HEADER_KEY = '__sigx_list_header__';
const FOOTER_KEY = '__sigx_list_footer__';
const LOADING_KEY = '__sigx_list_loading__';

const DEFAULT_PULL_THRESHOLD = 64;

type ScrollDetail = { detail?: { scrollTop?: number; scrollLeft?: number } };

/**
 * `<List>` — a data-driven, virtualized list built on Lynx's native `<list>`
 * recycler. Only on-screen cells exist as native views regardless of how many
 * items are passed, so it stays smooth for long feeds and grids.
 *
 * ## Sizing
 * The native `<list>` only lays out with a **concrete** main-axis size
 * (flex/percent resolve to zero → nothing renders). So `class`/`style` land on
 * a measuring wrapper `<view>` (where flex sizing works as usual — e.g.
 * `style={{ flexGrow: 1 }}` inside a column), the wrapper measures itself via
 * `bindlayoutchange`, and the list is pinned to the measured px. The list
 * stays mounted from the first render (a 1px placeholder until the measure
 * lands). First paint is one frame after mount. Same pattern as `EmojiGrid` in
 * `@sigx/lynx-emoji`.
 *
 * ## Pull-to-refresh
 * Opt in by passing the controlled `refreshing` prop. A `Gesture.Pan` on the
 * content wrapper (built on the native gesture arena, same recipe as
 * `<Draggable>`) reveals a fixed-height indicator as you pull down while
 * scrolled to the top; releasing past `pullThreshold` emits `refresh`. The
 * indicator stays open while `refreshing` is true and animates away when it
 * flips back to false.
 *
 * ## Load-more
 * `onEndReached` fires once per edge-hit (de-duped until you scroll back up or
 * new items arrive). Set `loadingMore` to show a trailing loading cell.
 *
 * @example
 * ```tsx
 * <List
 *   items={messages}
 *   keyExtractor={(m) => m.id}
 *   renderItem={(m) => <MessageRow message={m} />}
 *   style={{ flexGrow: 1 }}
 *   refreshing={refreshing.value}
 *   onRefresh={() => reload()}
 *   loadingMore={loadingMore.value}
 *   onEndReached={() => loadMore()}
 * />
 * ```
 */
const ListImpl = component<ListProps>(({ props, slots, emit }) => {
  const { layout, onLayoutChange } = useElementLayout();

  // ── Pull-to-refresh wiring (captured once at setup, like <Draggable>) ──
  // Opting in is signalled by passing the controlled `refreshing` prop; when
  // it's absent the gesture/animation paths stay inert (the refs never bind to
  // a rendered element) so plain feeds pay nothing.
  const refreshEnabled = props.refreshing !== undefined;
  const pullThreshold = props.pullThreshold ?? DEFAULT_PULL_THRESHOLD;

  const contentRef = useMainThreadRef<MainThread.Element | null>(null);
  const pull = useSharedValue(0);
  useAnimatedStyle(contentRef, pull, 'translateY');

  // MT-side mirrors read by the gesture worklets.
  const atTopRef = useMainThreadRef<boolean>(true);
  const refreshingMTRef = useMainThreadRef<boolean>(props.refreshing ?? false);
  const gst = useMainThreadRef<{ startY: number; canPull: boolean; active: boolean }>({
    startY: 0,
    canPull: false,
    active: false,
  });

  // BG signal gating the list's `enable-scroll` while a pull is in progress so
  // the recycler doesn't also consume the drag (mirrors <Draggable> ↔
  // <ScrollView> coordination).
  const pulling = signal(false);

  const pan = Gesture.Pan()
    .minDistance(0)
    // Load-bearing no-op: iOS only fires onStart/onEnd when an onBegin is
    // registered (see <Draggable>).
    .onBegin(() => {
      'main thread';
    })
    .onStart((e: { params?: { pageY?: number } }) => {
      'main thread';
      if (!refreshEnabled) return;
      const p = e && e.params;
      gst.current.startY = (p && p.pageY) || 0;
      gst.current.canPull = atTopRef.current && !refreshingMTRef.current;
      gst.current.active = false;
    })
    .onUpdate((e: { params?: { pageY?: number } }) => {
      'main thread';
      if (!refreshEnabled || !gst.current.canPull) return;
      const p = e && e.params;
      const dy = ((p && p.pageY) || 0) - gst.current.startY;
      const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as
        (() => void) | undefined;
      if (dy <= 0) {
        pull.current.value = 0;
        if (__flush) __flush();
        return;
      }
      // Rubber-band resistance; cap a little past the threshold.
      const resisted = dy * 0.5;
      const max = pullThreshold * 1.5;
      pull.current.value = resisted > max ? max : resisted;
      if (__flush) __flush();
      if (!gst.current.active) {
        gst.current.active = true;
        runOnBackground(() => { pulling.value = true; })();
      }
    })
    .onEnd(() => {
      'main thread';
      if (!refreshEnabled || !gst.current.canPull) return;
      gst.current.active = false;
      const crossed = pull.current.value >= pullThreshold && !refreshingMTRef.current;
      const target = crossed ? pullThreshold : 0;
      // Inline ease-out tween (no imported helper — function imports don't
      // survive worklet `_c` capture; same constraint <Draggable> works around).
      const from = pull.current.value;
      const start = Date.now();
      const dur = 240;
      const raf = (globalThis as Record<string, unknown>)['requestAnimationFrame'] as
        ((cb: () => void) => void) | undefined;
      const flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as
        (() => void) | undefined;
      const tick = (): void => {
        const t = Math.min((Date.now() - start) / dur, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        pull.current.value = from + (target - from) * eased;
        if (flush) flush();
        if (t < 1 && raf) raf(tick);
      };
      if (raf) raf(tick);
      else { pull.current.value = target; if (flush) flush(); }
      if (crossed) {
        refreshingMTRef.current = true;
        runOnBackground(() => { pulling.value = false; emit('refresh'); })();
      } else {
        runOnBackground(() => { pulling.value = false; })();
      }
    });

  useGestureDetector(contentRef, pan);

  // Mirror the controlled `refreshing` prop to MT: close the indicator (tween
  // pull→0) when a refresh completes, and open it for a programmatic refresh
  // that wasn't started by a pull.
  const syncRefreshing = runOnMainThread((r: boolean) => {
    'main thread';
    const was = refreshingMTRef.current;
    refreshingMTRef.current = r;
    const target = !r ? 0 : (pull.current.value < 1 ? pullThreshold : pull.current.value);
    if (r === was || target === pull.current.value) return;
    const from = pull.current.value;
    const start = Date.now();
    const dur = 240;
    const raf = (globalThis as Record<string, unknown>)['requestAnimationFrame'] as
      ((cb: () => void) => void) | undefined;
    const flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as
      (() => void) | undefined;
    const tick = (): void => {
      const t = Math.min((Date.now() - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      pull.current.value = from + (target - from) * eased;
      if (flush) flush();
      if (t < 1 && raf) raf(tick);
    };
    if (raf) raf(tick);
    else { pull.current.value = target; if (flush) flush(); }
  });
  effect(() => {
    const r = props.refreshing ?? false;
    if (refreshEnabled) syncRefreshing(r);
  });

  // ── Load-more de-dup (BG; persists across renders since setup runs once) ──
  let endReachedFired = false;
  let lastTop = 0;
  let prevCount = props.items.length;

  return () => {
    const horizontal = props.horizontal ?? false;
    const items = props.items;
    const count = items.length;

    // New items arrived → re-arm onEndReached for the next edge-hit.
    if (count !== prevCount) {
      endReachedFired = false;
      prevCount = count;
    }

    // Pin the list to the measured main-axis size; 1px placeholder until the
    // wrapper's first layout pass lands.
    const measured = horizontal ? layout.value?.width : layout.value?.height;
    const mainAxisPx = measured && measured > 0 ? `${measured}px` : '1px';
    const listStyle: Record<string, string | number> = horizontal
      ? { width: mainAxisPx, height: '100%' }
      : { height: mainAxisPx, width: '100%' };

    const keyOf = props.keyExtractor;
    const typeOf = props.itemType;
    const estimated = props.estimatedItemSize;

    // Empty state replaces the list body (the wrapper still has a child, so it
    // keeps measuring and the list can mount once items arrive).
    const showEmpty = count === 0 && !!slots.empty;

    // Trailing cell: a loading row while `loadingMore`, else the footer slot.
    const trailing = props.loadingMore ? (
      <list-item item-key={LOADING_KEY} item-type="__footer" full-span key={LOADING_KEY}>
        {slots.footer
          ? slots.footer()
          : (
            <view style={{ padding: '12px', alignItems: 'center' }}>
              <text style={{ opacity: 0.6 }}>Loading…</text>
            </view>
          )}
      </list-item>
    ) : slots.footer ? (
      <list-item item-key={FOOTER_KEY} item-type="__footer" full-span key={FOOTER_KEY}>
        {slots.footer()}
      </list-item>
    ) : null;

    const listEl = (
      <list
        style={listStyle}
        scroll-orientation={horizontal ? 'horizontal' : 'vertical'}
        list-type={props.listType ?? 'single'}
        span-count={props.numColumns ?? 1}
        main-thread:ref={props.mtRef}
        // Spread optional attrs only when set — an `undefined` prop is
        // serialized as a native `null` attribute write (no skip in
        // patchProp), which would clobber the native default.
        {...(props.itemSnap !== undefined ? { 'item-snap': props.itemSnap } : {})}
        {...(props.onEndReachedThreshold !== undefined
          ? { 'lower-threshold-item-count': props.onEndReachedThreshold }
          : {})}
        {...(props.onStartReachedThreshold !== undefined
          ? { 'upper-threshold-item-count': props.onStartReachedThreshold }
          : {})}
        {...(props.scrollEventThrottle !== undefined
          ? { 'scroll-event-throttle': props.scrollEventThrottle }
          : {})}
        {...(refreshEnabled ? { 'enable-scroll': !pulling.value } : {})}
        {...(refreshEnabled
          ? {
            'main-thread-bindscroll': (e: ScrollDetail) => {
              'main thread';
              atTopRef.current = ((e && e.detail && e.detail.scrollTop) || 0) <= 0;
            },
          }
          : {})}
        bindscrolltolower={() => {
          if (!endReachedFired) {
            endReachedFired = true;
            emit('endReached');
          }
        }}
        bindscrolltoupper={() => {
          endReachedFired = false;
          emit('startReached');
        }}
        bindscroll={(e: ScrollDetail) => {
          const d = e?.detail;
          if (!d) return;
          const top = (horizontal ? d.scrollLeft : d.scrollTop) ?? 0;
          // Scrolled back up away from the end → re-arm onEndReached.
          if (top < lastTop - 4) endReachedFired = false;
          lastTop = top;
          emit('scroll', { offset: top });
        }}
      >
        {slots.header && (
          <list-item item-key={HEADER_KEY} item-type="__header" full-span key={HEADER_KEY}>
            {slots.header()}
          </list-item>
        )}
        {items.map((item, i) => {
          const key = keyOf ? keyOf(item, i) : String(i);
          return (
            <list-item
              key={key}
              item-key={key}
              item-type={typeOf ? typeOf(item, i) : 'item'}
              {...(estimated !== undefined
                ? { 'estimated-main-axis-size-px': estimated }
                : {})}
            >
              {props.renderItem(item, i)}
            </list-item>
          );
        })}
        {trailing}
      </list>
    );

    let body: unknown;
    if (showEmpty) {
      body = slots.empty?.();
    } else if (refreshEnabled) {
      // Content wrapper is translated down by `pull`; the indicator sits one
      // threshold above it (hidden) and is revealed as the pull grows.
      body = (
        <view main-thread:ref={contentRef} style={{ height: '100%', position: 'relative' }}>
          <view
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${-pullThreshold}px`,
              height: `${pullThreshold}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {slots.refresh
              ? slots.refresh()
              : <text style={{ opacity: 0.6 }}>Refreshing…</text>}
          </view>
          {listEl}
        </view>
      );
    } else {
      body = listEl;
    }

    return (
      <view
        class={props.class}
        style={props.style}
        bindlayoutchange={onLayoutChange}
      >
        {body}
      </view>
    );
  };
});

// `component()` transforms the prop markers (`Define.Slot`/`Define.Event`) into
// the real JSX surface (`slots`, `onEndReached`, …). Re-type only `items` /
// `renderItem` (and the other T-referencing props) generically over the item
// type `T` so callers get inference while keeping the transformed slots/events
// intact — the plain `<T>(props: ListProps<T>)` cast used by `Swiper` would
// drop both.
type ListJsxProps = Parameters<typeof ListImpl>[0];

/** {@inheritDoc ListImpl} */
export const List = ListImpl as unknown as <T>(
  props: Omit<ListJsxProps, 'items' | 'renderItem' | 'keyExtractor' | 'itemType'> & {
    items: readonly T[];
    renderItem: (item: T, index: number) => unknown;
    keyExtractor?: (item: T, index: number) => string;
    itemType?: (item: T, index: number) => string;
  },
) => unknown;
