import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import type { SetterResult, SystemBarStyle, SystemBarsStyleInput } from './types.js';

const MODULE = 'Appearance';

const UNSUPPORTED: SetterResult = { ok: false, reason: 'unsupported' };

/**
 * Set the status-bar *content* tint (clock + icons).
 *
 * - `'light'` = light content (white-ish icons) — use when behind a dark theme.
 * - `'dark'`  = dark content — use when behind a light theme.
 *
 * On iOS the host VC must forward `preferredStatusBarStyle` to
 * `AppearanceModule.preferredStatusBarStyle` for this to take effect — the
 * lynx-cli iOS template wires that automatically.
 *
 * Resolves `{ ok: false, reason: 'unsupported' }` (never rejects) when the
 * native module isn't registered — typical in web preview, SSR, tests, or
 * apps that don't link the module. Fire-and-forget callers can therefore
 * `void setStatusBarStyle(...)` without risking unhandled rejections.
 */
export function setStatusBarStyle(style: SystemBarStyle): Promise<SetterResult> {
  if (!isAvailable()) return Promise.resolve(UNSUPPORTED);
  return callAsync<SetterResult>(MODULE, 'setStatusBarStyle', { style });
}

/**
 * Android only — set the status-bar background color. Pass `null` (or
 * omit / pass `'transparent'`) to clear. iOS resolves `{ ok: false,
 * reason: 'unsupported' }` since iOS has no separate status-bar background.
 *
 * On Android 15+ (API 35) edge-to-edge is enforced and this call is a no-op
 * at the system level — callers should overlay their own background view
 * inside the safe-area top padding.
 *
 * Resolves `{ ok: false, reason: 'unsupported' }` (never rejects) when the
 * native module isn't registered. See `setStatusBarStyle` for the rationale.
 */
export function setStatusBarBackgroundColor(color: string | null): Promise<SetterResult> {
  if (!isAvailable()) return Promise.resolve(UNSUPPORTED);
  return callAsync<SetterResult>(MODULE, 'setStatusBarBackgroundColor', { color });
}

/**
 * Android only — set the navigation-bar content tint + optional background.
 * iOS resolves `{ ok: false, reason: 'unsupported' }` since there's no
 * separate navigation bar.
 *
 * Resolves `{ ok: false, reason: 'unsupported' }` (never rejects) when the
 * native module isn't registered. See `setStatusBarStyle` for the rationale.
 */
export function setNavigationBarStyle(opts: { style: SystemBarStyle; color?: string }): Promise<SetterResult> {
  if (!isAvailable()) return Promise.resolve(UNSUPPORTED);
  return callAsync<SetterResult>(MODULE, 'setNavigationBarStyle', opts);
}

/**
 * Convenience: apply status-bar tint + (optionally) status-bar background +
 * nav-bar tint in one call. Resolves to the aggregate result — `ok: false`
 * if any leg returned a non-`unsupported` failure, with the first such
 * failure's reason. `unsupported` legs (e.g. status-bar background on iOS)
 * are intentionally ignored so a partially-supported platform can still
 * report success for the legs that do apply.
 *
 * Fields are optional; omitting any leaves that surface untouched. Order is
 * deterministic (statusBar → statusBarBackground → navigationBar) so the
 * resolved reason on partial failure is unambiguous.
 */
export async function setSystemBarsStyle(opts: SystemBarsStyleInput): Promise<SetterResult> {
  if (!isAvailable()) return UNSUPPORTED;
  let firstFailure: SetterResult | undefined;
  const record = (r: SetterResult): void => {
    if (!r.ok && !firstFailure && r.reason !== 'unsupported') firstFailure = r;
  };
  if (opts.statusBar) record(await setStatusBarStyle(opts.statusBar));
  if (opts.statusBarBackground !== undefined) {
    record(await setStatusBarBackgroundColor(opts.statusBarBackground));
  }
  if (opts.navigationBar) record(await setNavigationBarStyle(opts.navigationBar));
  return firstFailure ?? { ok: true };
}

/** Quick check whether the native Appearance module is registered. */
export function isAvailable(): boolean {
  return isModuleAvailable(MODULE);
}
