/**
 * Per-edge inset values, in dp/pt (logical pixels). Top/right/bottom/left
 * follow CSS shorthand order. Keyboard, statusBar, navigationBar are
 * informational extras populated when the host platform exposes them — they
 * may be 0 if unknown.
 */
export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** IME (soft keyboard) height when visible, 0 when hidden. */
  keyboard: number;
  /** Status-bar height (top system bar). Often equal to `top`, but on
   *  notched devices the safe-area top includes the notch and the status
   *  bar is the smaller status-only inset. */
  statusBar: number;
  /** Navigation-bar height (Android gesture/3-button nav at bottom). */
  navigationBar: number;
}

/**
 * The four standard CSS edges. Subset to control which sides
 * `<SafeAreaView>` applies inset padding/margin to.
 */
export type Edge = 'top' | 'right' | 'bottom' | 'left';

/** Whether `<SafeAreaView>` applies its insets as `padding` or `margin`. */
export type SafeAreaMode = 'padding' | 'margin';

/**
 * The injectable shape exposed by `<SafeAreaProvider>`. Components that need
 * insets reactively read `insets.value` (BG signal) or, for MT-driven
 * layouts, subscribe to per-edge `SharedValue`s.
 */
export interface SafeAreaContextValue {
  /** BG-side reactive insets. Re-renders the consumer on change. */
  readonly insets: import('@sigx/reactivity').PrimitiveSignal<EdgeInsets>;
  /** Per-edge SharedValues for MT-driven `useAnimatedStyle` bindings. */
  readonly sv: {
    top: import('@sigx/lynx').SharedValue<number>;
    right: import('@sigx/lynx').SharedValue<number>;
    bottom: import('@sigx/lynx').SharedValue<number>;
    left: import('@sigx/lynx').SharedValue<number>;
  };
}

export const ZERO_INSETS: EdgeInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  keyboard: 0,
  statusBar: 0,
  navigationBar: 0,
};
