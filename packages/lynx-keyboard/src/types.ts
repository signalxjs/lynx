import type { Define } from '@sigx/lynx';

/**
 * RN-mirroring behavior modes for `<KeyboardAvoidingView>`:
 * - `'padding'`  — add `paddingBottom` equal to the keyboard overlap, squeezing
 *   the flex column so ALL content stays above the keyboard.
 * - `'translate'` — shift the whole container up by the overlap (content at the
 *   top moves off-screen; layout does not reflow).
 * - `'height'`   — append a spacer view of the overlap height (RN parity).
 */
export type KeyboardAvoidingBehavior = 'padding' | 'translate' | 'height';

/** BG-reactive keyboard state returned by `useKeyboard()`. */
export interface KeyboardState {
  /** Soft-keyboard height in dp; 0 when hidden. */
  height: number;
  visible: boolean;
}

export type KeyboardAvoidingViewProps =
  & Define.Prop<'behavior', KeyboardAvoidingBehavior, false>
  & Define.Prop<'keyboardVerticalOffset', number, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>;

export type KeyboardStickyViewProps =
  /** Extra gap (dp) between the bar and the keyboard's top edge. */
  & Define.Prop<'offset', number, false>
  /**
   * `true` (default): smooth MT-driven translateY via SharedValue + timing.
   * `false`: plain BG re-render with an inline transform (debug fallback).
   */
  & Define.Prop<'animated', boolean, false>
  /**
   * Subtract the bottom safe-area inset from the lift (default `true`).
   * Keep `true` when an ancestor `<SafeAreaView edges={['bottom']}>` already
   * pads the home-indicator inset — the keyboard covers that region, so the
   * bar only needs to rise by the difference. Set `false` if no ancestor
   * applies the bottom inset.
   */
  & Define.Prop<'discountBottomInset', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>;
