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
    // Default to filling the parent (flex-grow + flex-column). Lynx (like
    // React Native) does NOT treat `flex: 1` shorthand the way browsers
    // do — its `flexBasis` resolves to `'auto'`, which sizes to content
    // and collapses the chain. The long-form `flexBasis: 0` is the only
    // reliable way to "fill remaining space." Bottom chrome like
    // `<NavTabBar />` from `@sigx/lynx-daisyui` won't park itself at the
    // screen edge without this.
    const baseStyle: Record<string, string | number> = {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
    };
    if (edges.includes('top')) {
      baseStyle[mode === 'padding' ? 'paddingTop' : 'marginTop'] = `${i.top}px`;
    }
    if (edges.includes('right')) {
      baseStyle[mode === 'padding' ? 'paddingRight' : 'marginRight'] = `${i.right}px`;
    }
    if (edges.includes('bottom')) {
      baseStyle[mode === 'padding' ? 'paddingBottom' : 'marginBottom'] = `${i.bottom}px`;
    }
    if (edges.includes('left')) {
      baseStyle[mode === 'padding' ? 'paddingLeft' : 'marginLeft'] = `${i.left}px`;
    }
    return (
      <view
        class={props.class}
        style={props.style ? { ...baseStyle, ...props.style } : baseStyle}
      >
        {slots.default?.()}
      </view>
    );
  };
});
