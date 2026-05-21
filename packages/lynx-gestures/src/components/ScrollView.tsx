import {
  component,
  signal,
  useSharedValue,
  useMainThreadRef,
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

  defineProvide(useScrollContext, () => ({
    dragging,
    scrollViewRef,
    offsetX: x,
    offsetY: y,
    scrollOrientation,
  }));

  return () => {
    // Compose user-passed enable-scroll with the descendant-driven flag:
    // both must be true. User can still force-lock by passing `false`.
    const userEnableScroll = props['enable-scroll'] ?? true;
    const enableScroll = userEnableScroll && !dragging.value;
    return (
      <scroll-view
        main-thread:ref={scrollViewRef}
        scroll-orientation={scrollOrientation}
        enable-scroll={enableScroll}
        class={props.class}
        style={props.style}
        main-thread-bindscroll={(e: any) => {
          'main thread';
          y.current.value = e.detail.scrollTop;
          x.current.value = e.detail.scrollLeft;
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
