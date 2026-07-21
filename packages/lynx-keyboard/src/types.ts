import type { Define, SharedValue } from '@sigx/lynx';

/**
 * RN-mirroring behavior modes for `<KeyboardAvoidingView>`:
 * - `'padding'`  — add `paddingBottom` equal to the keyboard overlap, squeezing
 *   the flex column so ALL content stays above the keyboard.
 * - `'translate'` — shift the whole container up by the overlap (content at the
 *   top moves off-screen; layout does not reflow).
 * - `'height'`   — append a trailing spacer view of the overlap height, so
 *   the content above is squeezed without touching the container's padding.
 *   (Closest analogue of RN's height-resizing behavior; the implementation
 *   differs — RN shrinks the container's own height, this inserts a spacer.)
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
  /**
   * Subtract the bottom safe-area inset from the lift (default `true`).
   * Keep `true` when an ancestor `<SafeAreaView edges={['bottom']}>` already
   * pads the home-indicator inset; set `false` to lift by the full keyboard
   * height when no ancestor applies the bottom inset.
   */
  & Define.Prop<'discountBottomInset', boolean, false>
  /**
   * Stop avoiding the keyboard — the lift freezes at 0 (no padding /
   * translate / spacer), instantly. Pass `true` whenever something ELSE
   * already occupies the keyboard's space in flow, e.g. a composer's emoji
   * panel while it is painted: the panel and this view would otherwise both
   * claim the same pixels and squeeze the content between them (a dark band
   * eating the message list as the keyboard rises back over the panel).
   * Pair it with `<KeyboardStickyView pinned>` — the same condition drives
   * both (`useKeyboardPanelReveal`'s `engaged()` in `@sigx/lynx-emoji`).
   */
  & Define.Prop<'pinned', boolean, false>
  /**
   * An extra bottom lift the content must also clear — it shrinks by
   * `max(keyboardLift, extraLiftSV)`. Pass a bottom accessory's live height
   * (e.g. `@sigx/lynx-navigation`'s `useSheetHeight()`) so an emoji sheet
   * overlaying the bottom pushes the thread up as well, not only the
   * keyboard. Same unit as the lift (dp); `pinned` still zeroes it.
   */
  & Define.Prop<'extraLiftSV', SharedValue<number>, false>
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
   * Freeze the bar IN FLOW (translateY pinned to 0, instantly — never
   * animated) while an app panel occupies the keyboard's space: the
   * WhatsApp keyboard ⇄ emoji-panel swap. Pin in the same frame the panel
   * gets its height (= the remembered lift) and the bar doesn't move a
   * pixel; the system keyboard's own show/hide animation does ALL the
   * visible motion, covering or revealing the already-painted panel.
   * Live lift tracking resumes when unset.
   */
  & Define.Prop<'pinned', boolean, false>
  /**
   * Subtract the bottom safe-area inset from the lift (default `true`).
   * Keep `true` when an ancestor `<SafeAreaView edges={['bottom']}>` already
   * pads the home-indicator inset — the keyboard covers that region, so the
   * bar only needs to rise by the difference. Set `false` if no ancestor
   * applies the bottom inset.
   */
  & Define.Prop<'discountBottomInset', boolean, false>
  /**
   * An extra lift the bar must ALSO clear — the bar rides
   * `max(keyboardLift, extraLiftSV)`. Pass a bottom accessory's live height
   * SharedValue (e.g. `@sigx/lynx-navigation`'s `useSheetHeight()` for an
   * emoji sheet) so the bar sits above WHICHEVER of the keyboard or the
   * accessory is taller — and, because it's a max, the swap between them is
   * dip-free as long as one shrinks while the other grows. Absent ⇒ the bar
   * tracks the keyboard alone (unchanged). The height must be in the same
   * unit as the keyboard lift (dp).
   */
  & Define.Prop<'extraLiftSV', SharedValue<number>, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>;
