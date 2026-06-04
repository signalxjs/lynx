// Public API for @sigx/lynx-keyboard.
//
// Soft-keyboard handling with an RN-mirroring API. Keyboard height reaches
// JS through the safe-area bridge (`@sigx/lynx-safe-area`) — this package
// turns that inset into ready-made layout primitives. Keyboard handling is
// its own concern, separate from safe-area, mirroring the RN ecosystem
// (react-native core / react-native-keyboard-controller vs
// react-native-safe-area-context).

export { KeyboardAvoidingView } from './keyboard-avoiding-view.js';
export {
  KeyboardStickyView,
  // RN aliases: core's InputAccessoryView role is covered by the sticky
  // view; react-native-keyboard-controller names for the same shape.
  KeyboardStickyView as KeyboardAccessoryView,
  KeyboardStickyView as KeyboardToolbar,
} from './keyboard-sticky-view.js';
export { useKeyboard, useKeyboardLift, useKeyboardLiftSV } from './use-keyboard.js';
export type {
  KeyboardAvoidingBehavior,
  KeyboardAvoidingViewProps,
  KeyboardState,
  KeyboardStickyViewProps,
} from './types.js';
