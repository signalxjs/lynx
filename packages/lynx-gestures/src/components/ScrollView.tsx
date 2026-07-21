import {
  component,
  onUnmounted,
  runOnMainThread,
  signal,
  useSharedValue,
  useMainThreadRef,
  useScrollDragHost,
  defineProvide,
  type SharedValue,
  type Define,
  type MainThread,
} from '@sigx/lynx';
import { useScrollContext } from '../scroll-context.js';

export type ScrollViewProps =
  & Define.Prop<'offsetX', SharedValue<number>, false>
  & Define.Prop<'offsetY', SharedValue<number>, false>
  & Define.Prop<'scroll-orientation', 'vertical' | 'horizontal', false>
  /**
   * Toggle native scroll responsiveness at runtime — set false to lock the
   * scroll-view (e.g. while a child `<Draggable>` is mid-drag, so Lynx's
   * native pan gesture doesn't steal the touch). Maps to Lynx's
   * `enable-scroll` attribute.
   */
  & Define.Prop<'enable-scroll', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>;

/**
 * MT-thread `<scroll-view>` wrapper that mirrors scroll position into a
 * `SharedValue`. Pair with `useAnimatedStyle` for parallax / fade / scale
 * effects driven by scroll, all running on MT with zero per-frame thread
 * crossings.
 *
 * The component is the API; the inline `'main thread'` worklet, the
 * `__FlushElementTree()` trigger, and the runtime registration are all
 * internal. Users just pass a `SharedValue<number>` for the axis they care
 * about — same shape as `<Draggable translateX={tx}>`.
 *
 * @example Parallax header
 * ```tsx
 * const scrollY = useSharedValue(0);
 * const headerRef = useMainThreadRef<MainThread.Element | null>(null);
 *
 * useAnimatedStyle(headerRef, scrollY, 'translateY', {
 *   inputRange: [0, 300], outputRange: [0, -150], extrapolate: 'clamp',
 * });
 *
 * <ScrollView offsetY={scrollY}>
 *   <view main-thread:ref={headerRef}><image src={hero} /></view>
 *   <text>Body…</text>
 * </ScrollView>
 * ```
 *
 * @example BG-reactive scroll readout
 * ```tsx
 * const scrollY = useSharedValue(0);
 * <ScrollView offsetY={scrollY}>...</ScrollView>
 * <text>Scrolled: {scrollY.value.toFixed(0)}px</text>
 * ```
 */
export const ScrollView = component<ScrollViewProps>(({ props, slots }) => {
  // Always allocate fallback SharedValues — hooks must run unconditionally.
  // The render closure picks between own/external; the worklet always sees
  // a defined SharedValue in its `_c` capture.
  const ownX = useSharedValue(0);
  const ownY = useSharedValue(0);

  // Phase 2.12 ScrollView ↔ child-gesture coordination. Descendant
  // `<Draggable>` / `<Swipeable>` flip this signal during their drag so the
  // UIKit `panGestureRecognizer` (which doesn't participate in the new
  // gesture arena) yields the touch. See `scroll-context.ts` for the why.
  const dragging = signal(false);

  // Phase 2.13: publish the scroll-view's element ref through the context so
  // descendants can drive scroll directly from worklets (e.g. <Draggable
  // edgeScroll>). Captured at setup so the worklet `_c` map sees a stable
  // ref identity.
  const scrollViewRef = useMainThreadRef<MainThread.Element | null>(null);

  // Pick the axis SVs once; the same identity is shared with descendants via
  // the context (so they can read live scroll position) and used at render
  // time for the bindscroll worklet's `_c` capture.
  const x: SharedValue<number> = props.offsetX ?? ownX;
  const y: SharedValue<number> = props.offsetY ?? ownY;
  const scrollOrientation = props['scroll-orientation'] ?? 'vertical';

  // Drag↔scroll coordination with an ancestor full-surface drag container
  // (lynx-navigation's bottom sheet). Vertical ScrollViews only — a
  // horizontal scroller is orthogonal to a vertical sheet drag. The FIRST
  // vertical ScrollView mounted inside the host adopts (parent setup runs
  // before children, so the outermost — the sheet's primary scroller —
  // wins deterministically); later verticals aren't adopted but still
  // gate on the host's `scrollLock` below, so they freeze during sheet
  // drags instead of scrolling underneath.
  const dragHost = useScrollDragHost();
  const vertical = scrollOrientation === 'vertical';
  const hostRelease = dragHost && vertical ? dragHost.adoptVerticalScroll() : null;
  const adopted = hostRelease !== null ? 1 : 0;
  // Worklets must capture DEFINED SV identities — fall back to own SVs
  // when there's no host (the `adopted` gate skips the writes anyway).
  const hostOffsetY = adopted === 1 && dragHost ? dragHost.scrollOffsetY : ownY;
  const hostHasScroll = adopted === 1 && dragHost ? dragHost.hasVerticalScroll : ownX;
  // Adopted: the host's pre-allocated element ref becomes THE ref for this
  // scroll-view (one identity, shared by the host's worklets and our own
  // ScrollContext descendants). SVs are MT-write-only — flag adoption via
  // a one-hop MT write, and zero both handles back out on release so a
  // stale offset can't outlive this scroller (see scroll-drag-host.ts).
  const elRef = adopted === 1 && dragHost ? dragHost.scrollRef : scrollViewRef;
  if (adopted === 1) {
    runOnMainThread(() => {
      'main thread';
      hostHasScroll.current.value = 1;
    })();
    onUnmounted(() => {
      hostRelease?.();
      runOnMainThread(() => {
        'main thread';
        hostHasScroll.current.value = 0;
        hostOffsetY.current.value = 0;
      })();
    });
  }

  defineProvide(useScrollContext, () => ({
    dragging,
    scrollViewRef: elRef,
    offsetX: x,
    offsetY: y,
    scrollOrientation,
  }));

  return () => {
    // Compose user-passed enable-scroll with the descendant-driven flag
    // and (verticals inside a drag host) the host's scroll lock: all must
    // allow. User can still force-lock by passing `false`.
    const userEnableScroll = props['enable-scroll'] ?? true;
    const hostLocked = dragHost && vertical ? dragHost.scrollLock.value : false;
    const enableScroll = userEnableScroll && !dragging.value && !hostLocked;
    return (
      <scroll-view
        main-thread:ref={elRef}
        scroll-orientation={scrollOrientation}
        enable-scroll={enableScroll}
        // Adopted scrollers pin bounces off: the host's "content at top"
        // reads use `offset <= 0`, and iOS rubber-banding would let the
        // content follow a downward pull for the frames before the lock
        // lands. Defense-in-depth, not the primary mechanism.
        bounces={adopted === 1 ? false : undefined}
        class={props.class}
        style={props.style}
        main-thread-bindscroll={(e: any) => {
          'main thread';
          y.current.value = e.detail.scrollTop;
          x.current.value = e.detail.scrollLeft;
          // Mirror the live offset into the drag host so its pan worklet
          // can arbitrate ("content at top?") — additive to the normal
          // offset SVs, no precedence rules.
          if (adopted === 1) hostOffsetY.current.value = e.detail.scrollTop;
          // Apply useAnimatedStyle bindings on the same frame. Inlined
          // (rather than calling a helper) because plain function imports
          // don't survive worklet `_c` capture across the MT bundle —
          // same constraint @sigx/lynx-motion's `animate()` documents.
          const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as (() => void) | undefined;
          if (__flush) __flush();
        }}
      >
        {slots.default?.()}
      </scroll-view>
    );
  };
});
