/** The two color schemes the platform reports. iOS `unspecified` and
 *  Android `UI_MODE_NIGHT_UNDEFINED` both collapse to `'light'` at the
 *  native publisher boundary so JS only ever sees these two values. */
export type ColorScheme = 'light' | 'dark';

/** Tint of system-bar *content* (clock, icons), not its background. */
export type SystemBarStyle = 'light' | 'dark';

/** Result envelope returned by every native setter. */
export interface SetterResult {
  ok: boolean;
  /** Present when `ok === false` — `'unsupported'` on iOS for nav-bar and
   *  status-bar-background calls, or an Android failure message. */
  reason?: string;
}

/** Argument to `setSystemBarsStyle` — partial; omitted fields are left alone. */
export interface SystemBarsStyleInput {
  /** Status-bar content tint. `'light'` = light icons (legible on dark bg). */
  statusBar?: SystemBarStyle;
  /** Android only — status-bar background color. `null` clears (transparent). */
  statusBarBackground?: string | null;
  /** Android only — navigation-bar tint + optional background. */
  navigationBar?: { style: SystemBarStyle; color?: string };
}
