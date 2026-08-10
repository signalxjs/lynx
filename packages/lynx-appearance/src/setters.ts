/**
 * The `Appearance` native module's JS surface: the system-bar setters plus the
 * authoritative color-scheme read.
 *
 * Every method name is repeated as a string literal at its `callAsync` site on
 * purpose — `scripts/check-module-manifests.mjs` cross-checks call sites
 * against `signalx-module.json`, the Swift `methodLookup` and the Kotlin
 * `@LynxMethod`s textually (C12), and a tidier `call(action, …)` helper would
 * hide every name from it.
 */
import { callAsync, isModuleAvailable, unwrapNative } from '@sigx/lynx-core';
import { PKG } from './log.js';
import type { ColorScheme, SetterResult, SystemBarStyle, SystemBarsStyleInput } from './types.js';

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

/**
 * Whether the native Appearance module is registered in the current build.
 *
 * NOTE: this is a **bare** `isAvailable` at package root, which C2 forbids —
 * it collides with `@sigx/lynx-sqlite`'s under a barrel import. Renaming it to
 * `isAppearanceAvailable` is a breaking public change and is escalated to the
 * package's module-review issue (#866) rather than decided in a sweep; the
 * violation stays recorded in `scripts/api-conventions-baseline.json`.
 */
export function isAvailable(): boolean {
  return isModuleAvailable(MODULE);
}

/**
 * Ask the native module for the color scheme the OS reports *right now*.
 *
 * Prefer {@link readGlobalColorScheme} (synchronous, MT-safe) or
 * `useSystemColorScheme()` (reactive) — the publisher writes
 * `lynx.__globalProps.appearance` before MT first paint and pushes every flip
 * as an `appearanceChanged` event, so the sync read is correct in normal use.
 * This one exists for the two cases the globalProps snapshot can't serve:
 *
 * - the module is linked but nothing has published yet (a host that builds its
 *   own LynxView without `AppearancePublisher`), so the sync read is `null`;
 * - the BG thread's `__globalProps` is a load-time snapshot that does not
 *   follow an in-place OS flip (#990), so code outside the event stream that
 *   needs today's truth has to ask native.
 *
 * Resolves `null` — rather than throwing (C3 opt-out, documented here and in
 * the README's Gotchas) — when the module isn't registered, matching
 * `readGlobalColorScheme()`'s "unknown, use your default theme" contract and
 * keeping the whole package non-throwing off-device. A genuine native failure
 * still throws `[@sigx/lynx-appearance] getColorScheme failed: …` (C4/C10).
 */
export async function getColorScheme(): Promise<ColorScheme | null> {
  if (!isAvailable()) return null;
  const raw = await callAsync<{ colorScheme?: string; error?: string } | undefined>(
    MODULE,
    'getColorScheme',
  );
  const value = unwrapNative(PKG, 'getColorScheme', raw);
  const scheme = value?.colorScheme;
  return scheme === 'dark' ? 'dark' : scheme === 'light' ? 'light' : null;
}
