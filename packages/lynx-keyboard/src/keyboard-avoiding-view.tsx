import { component } from '@sigx/lynx';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import type { KeyboardAvoidingViewProps } from './types.js';

/**
 * RN-mirroring `KeyboardAvoidingView`: wraps screen content and keeps it
 * above the soft keyboard. Default `behavior="padding"` squeezes the flex
 * column so nothing hides behind the keyboard.
 *
 * Implementation: BG signal + inline style, the same pattern as
 * lynx-safe-area's `<SafeAreaView>` — layout-affecting properties must NOT
 * be driven from the main thread (`setStyleProperties` layout writes fire
 * after the first layout pass and `<scroll-view>` won't reflow), so the
 * padding snaps to the final value in one re-render. The native keyboard
 * slide masks the snap. For a smoothly *animated* bar, use
 * `<KeyboardStickyView>` (transform-based, MT-animated) instead — and use
 * one or the other on a given subtree, not both, or it double-lifts.
 *
 * The bottom safe-area inset is discounted from the lift
 * (`max(0, keyboard - bottom + keyboardVerticalOffset)`) because an
 * ancestor `<SafeAreaView edges={['bottom']}>` typically already pads the
 * home indicator, which the keyboard covers when open.
 *
 * `pinned` turns the avoidance off (lift 0) for as long as something else
 * holds the keyboard's space in flow — see the prop's docs.
 */
export const KeyboardAvoidingView = component<KeyboardAvoidingViewProps>(({ props, slots }) => {
  const insets = useSafeAreaInsets();
  const behavior = props.behavior ?? 'padding';
  const kvo = props.keyboardVerticalOffset ?? 0;
  const discountBottomInset = props.discountBottomInset ?? true;

  return () => {
    const i = insets.value;
    // `pinned`: a sibling already occupies the keyboard's space (an emoji
    // panel mid-swap) — avoiding it too would count those pixels twice.
    const kbLift = i.keyboard > 0 && props.pinned !== true
      ? Math.max(0, i.keyboard - (discountBottomInset ? i.bottom : 0) + kvo)
      : 0;
    // `extraLiftSV` (a bottom accessory's live height, e.g. an emoji sheet):
    // shrink the content by whichever of keyboard/accessory is taller, so a
    // sheet overlaying the bottom pushes the thread up too (its auto-flushed
    // BG value is readable here). `pinned` still zeroes both.
    const extra = props.pinned === true ? 0 : (props.extraLiftSV?.value ?? 0);
    const lift = Math.max(kbLift, extra);
    // Fill-parent defaults, mirroring SafeAreaView: Lynx resolves the
    // `flex: 1` shorthand with `flexBasis: 'auto'`, which sizes to content
    // and collapses the chain — long-form `flexBasis: 0` is the only
    // reliable "fill remaining space".
    const base: Record<string, string | number> = {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
    };
    if (behavior === 'padding') {
      base['paddingBottom'] = `${lift}px`;
    } else if (behavior === 'translate') {
      base['transform'] = `translateY(-${lift}px)`;
    }
    return (
      <view class={props.class} style={props.style ? { ...base, ...props.style } : base}>
        {slots.default?.()}
        {behavior === 'height' ? <view style={{ height: `${lift}px`, flexShrink: 0 }} /> : null}
      </view>
    );
  };
});
