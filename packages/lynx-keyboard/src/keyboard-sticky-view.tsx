import {
  component,
  useAnimatedStyle,
  useMainThreadRef,
  type MainThread,
} from '@sigx/lynx';
import { useKeyboardLift, useKeyboardLiftSV } from './use-keyboard.js';
import type { KeyboardStickyViewProps } from './types.js';

/**
 * Pins its children to the top edge of the soft keyboard — the home for a
 * chat composer / input-accessory toolbar. (RN names: `KeyboardStickyView`
 * in react-native-keyboard-controller, `InputAccessoryView` in core.)
 *
 * The bar flows as a normal bottom flex sibling; when the keyboard opens it
 * is lifted with `transform: translateY(-lift)` where
 * `lift = max(0, keyboard - bottomInset + offset)`. Transform doesn't
 * reflow layout, so (unlike padding/height) it is safe to drive from the
 * main thread via `useAnimatedStyle` — see lynx-safe-area's
 * `safe-area-view.tsx` for why MT-driven *layout* writes are a trap.
 *
 * Note: because the bar is translated rather than re-laid-out, content
 * behind it (e.g. the bottom of a message list) does not shrink — it can
 * sit behind the keyboard. Pair with `<KeyboardAvoidingView
 * behavior="padding">` around the *content area only* (never around the bar
 * itself, or it double-lifts) when the content must stay fully visible.
 *
 * @example
 * ```tsx
 * <Col class="flex-fill">
 *   <KeyboardAvoidingView behavior="padding">
 *     <ScrollView class="flex-1">{messages}</ScrollView>
 *   </KeyboardAvoidingView>
 *   <KeyboardStickyView>
 *     <Toolbar />
 *     <Composer />
 *   </KeyboardStickyView>
 * </Col>
 * ```
 */
export const KeyboardStickyView = component<KeyboardStickyViewProps>(({ props, slots }) => {
  const animated = props.animated ?? true;
  const discountBottomInset = props.discountBottomInset ?? true;
  const offset = props.offset ?? 0;

  if (animated) {
    const barRef = useMainThreadRef<MainThread.Element | null>(null);
    const lift = useKeyboardLiftSV(discountBottomInset, offset);
    // factor -1: the SV stays a positive height; the mapper negates it so
    // the bar moves UP.
    useAnimatedStyle(barRef, lift, 'translateY', { factor: -1 });
    return () => (
      <view main-thread:ref={barRef} class={props.class} style={props.style}>
        {slots.default?.()}
      </view>
    );
  }

  // Debug / fallback path: discrete BG re-render, no tween.
  const lift = useKeyboardLift(discountBottomInset, offset);
  return () => (
    <view
      class={props.class}
      style={{ ...props.style, transform: `translateY(-${lift.value}px)` }}
    >
      {slots.default?.()}
    </view>
  );
});
