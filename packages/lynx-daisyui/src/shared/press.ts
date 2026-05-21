// Shared press-feedback defaults applied across all interactive daisyui
// components. Lynx has no CSS `:active` support, so press feedback comes from
// `<Pressable>` (in `@sigx/lynx-gestures`) flipping inline opacity/transform
// on the main thread.
export const PRESSED_SCALE = 0.97;
export const PRESSED_OPACITY = 0.85;
