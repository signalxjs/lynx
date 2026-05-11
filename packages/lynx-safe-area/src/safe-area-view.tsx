import { component, type Define } from '@sigx/lynx';
import { useSafeAreaInsets } from './hooks.js';
import type { Edge, SafeAreaMode } from './types.js';

export type SafeAreaViewProps =
  & Define.Prop<'edges', Edge[], false>
  & Define.Prop<'mode', SafeAreaMode, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>;

const ALL_EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];

/**
 * Drop-in container that applies the current safe-area insets as padding
 * (default) or margin on the configured edges.
 *
 * Implementation: BG signal + inline style. Sigx auto-tracks `insets.value`
 * access in the render function, so the inset values land in the FIRST
 * layout pass and re-apply reactively on every `safeAreaChanged` event.
 *
 * The previous implementation used `useAnimatedStyle` to drive padding via
 * the MT bridge — but `setStyleProperties` writes that affect layout fire
 * AFTER the first layout pass, and child elements that have already laid
 * out (notably `<scroll-view>`, which captures its frame eagerly) don't
 * reflow. Inline style avoids that timing trap entirely.
 *
 * `edges` defaults to all four sides. Pass a subset (e.g. `['top']`) to
 * leave the unspecified sides unaffected.
 *
 * Must be a descendant of `<SafeAreaProvider>`. If no provider is in scope
 * (test/storybook), `useSafeAreaInsets()` returns `ZERO_INSETS` with a
 * dev-mode warning and SafeAreaView passes through unchanged.
 *
 * @example
 * ```tsx
 * <SafeAreaProvider>
 *   <SafeAreaView edges={['top', 'bottom']} class="bg-base-100 flex-1">
 *     <PageContent />
 *   </SafeAreaView>
 * </SafeAreaProvider>
 * ```
 */
export const SafeAreaView = component<SafeAreaViewProps>(({ props, slots }) => {
  const insets = useSafeAreaInsets();
  const edges = props.edges ?? ALL_EDGES;
  const mode = props.mode ?? 'padding';

  return () => {
    const i = insets.value;
    const insetStyle: Record<string, string | number> = {};
    if (edges.includes('top')) {
      insetStyle[mode === 'padding' ? 'paddingTop' : 'marginTop'] = `${i.top}px`;
    }
    if (edges.includes('right')) {
      insetStyle[mode === 'padding' ? 'paddingRight' : 'marginRight'] = `${i.right}px`;
    }
    if (edges.includes('bottom')) {
      insetStyle[mode === 'padding' ? 'paddingBottom' : 'marginBottom'] = `${i.bottom}px`;
    }
    if (edges.includes('left')) {
      insetStyle[mode === 'padding' ? 'paddingLeft' : 'marginLeft'] = `${i.left}px`;
    }
    return (
      <view
        class={props.class}
        style={props.style ? { ...props.style, ...insetStyle } : insetStyle}
      >
        {slots.default?.()}
      </view>
    );
  };
});
