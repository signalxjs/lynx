import {
    callAsync,
    isModuleAvailable,
    SigxError,
    unwrapNative,
    unwrapNativeVoid,
} from '@sigx/lynx-core';

const MODULE = 'SecureStorage';
/** Package short name (no scope), as `unwrapNative`/`SigxError` want it. */
const PKG = 'lynx-secure-storage';

// The JS surface is setItem/getItem/removeItem (matching @sigx/lynx-storage,
// localStorage and expo-secure-store); the native wire names stay set/get/
// delete. That asymmetry is deliberate — the wire name isn't public API, and
// renaming it would churn Swift, Kotlin and the manifest for no caller benefit.
// Don't "fix" it.

export interface SecureStorageSetOptions {
    /**
     * When true, the OS will require biometric authentication on every
     * subsequent `getItem` of this key.
     *
     * - iOS: stored with `kSecAccessControlBiometryCurrentSet`. The OS shows
     *   the Face ID / Touch ID prompt automatically inside the Keychain
     *   query — no extra JS call is needed.
     * - Android: the key is generated with
     *   `setUserAuthenticationRequired(true)`. `getItem` must drive a
     *   `BiometricPrompt` to authorise the `Cipher`, which is why
     *   [SecureStorageGetOptions] exposes `biometricPrompt`.
     */
    requireBiometric?: boolean;
}

export interface SecureStorageBiometricPrompt {
    /** iOS: localizedReason for LAContext. Android: prompt subtitle. */
    reason: string;
    /** Android only — prompt title. Defaults to "Authenticate". */
    title?: string;
}

export interface SecureStorageGetOptions {
    /**
     * Required when the key was stored with `requireBiometric: true`.
     * Android needs the strings to render `BiometricPrompt`; iOS only uses
     * `reason` (the OS prompt title is fixed).
     */
    biometricPrompt?: SecureStorageBiometricPrompt;
}

interface NativeResult {
    ok?: boolean;
    error?: string;
    value?: string | null;
    exists?: boolean;
}

/**
 * Reject bad arguments before they reach the bridge.
 *
 * A `SigxError` like every other failure here, with its own `code` — the
 * README tells callers to branch on `code` rather than the message, which is
 * only true if the argument guards carry one too (C10).
 */
function invalidArgument(action: string, detail: string): SigxError {
    return new SigxError(PKG, 'invalid_argument', `[@sigx/${PKG}] ${action} failed: ${detail}`);
}

/**
 * Settle a write (`set` / `delete` / `clear`): the `{ error }` envelope throws
 * via core's `unwrapNative` (C4), and a payload that carries no `ok: true`
 * throws too.
 *
 * The second check is not envelope handling — core can't know about it — but
 * it is what the pre-`unwrapNative` code did, and it matters more here than
 * anywhere else: both natives acknowledge every successful write with
 * `{ ok: true }` (`ios/SecureStorageModule.swift:89,156,169`,
 * `android/…/SecureStorageModule.kt:87,122,137`), so a payload without it
 * means the write never happened, and reporting a credential as stored when
 * it isn't is the worst way for this package to be wrong.
 */
function unwrapAck(action: string, raw: NativeResult | null | undefined): void {
    unwrapNativeVoid(PKG, action, raw);
    if (raw?.ok !== true) {
        throw new SigxError(
            PKG,
            'native_error',
            `[@sigx/${PKG}] ${action} failed: native did not acknowledge the write`,
            { cause: raw },
        );
    }
}

/**
 * Encrypted at-rest key-value storage — iOS Keychain, Android Keystore +
 * EncryptedSharedPreferences.
 *
 * For plaintext settings use [`@sigx/lynx-storage`](../lynx-storage). Use
 * this package for credentials, refresh tokens, PII, and anything else
 * that must survive a casual filesystem dump.
 *
 * Pairs with [`@sigx/lynx-biometric`](../lynx-biometric) when you also need
 * an explicit auth gate (e.g. unlock-on-launch). The `requireBiometric`
 * flag here gates the *individual key* via the OS Keychain / Keystore;
 * use lynx-biometric for the broader "unlock the app" flow.
 *
 * Every method **throws** on failure (C3/C4), always as a `SigxError` with a
 * `code` to branch on: `'invalid_argument'` for a bad key or value,
 * `'module_unavailable'` when the native module isn't linked (core's
 * descriptive `getModule` error), and `'native_error'` for a failure reported
 * by the platform — the natives resolve their callback with `{ error }` rather
 * than rejecting, so each call unwraps that envelope.
 *
 * `hasKey` is the one exception on the argument guard: it is a predicate, so
 * an unusable key resolves `false` rather than throwing `'invalid_argument'` —
 * the same answer native gives for a key that was never stored. It still
 * throws for the other two codes.
 *
 * There is no `cancelled` result here: dismissing the biometric prompt is one
 * of those native failures (`error: 'userCancel'` on both platforms —
 * `ios/SecureStorageModule.swift:136`, `android/…/SecureStorageModule.kt:270`)
 * and always was, so it throws like the rest. A caller that wants to treat a
 * dismiss as ordinary matches on the message until the findings on #903 give
 * these a `code` of their own.
 *
 * The one non-throwing "nothing there" is a key that was never stored:
 * `getItem` resolves `null` and `hasKey` resolves `false`.
 *
 * @example
 * ```ts
 * import { SecureStorage } from '@sigx/lynx-secure-storage';
 *
 * await SecureStorage.setItem('access_token', token, { requireBiometric: true });
 *
 * const value = await SecureStorage.getItem('access_token', {
 *     biometricPrompt: { reason: 'Unlock your account', title: 'Acme Bank' },
 * });
 * ```
 */
export const SecureStorage = {
    /**
     * Store an encrypted string. Overwrites any existing value for `key`.
     * Setting `requireBiometric: true` makes future `getItem` calls prompt
     * for biometrics; the `setItem` call itself never prompts.
     */
    async setItem(
        key: string,
        value: string,
        opts: SecureStorageSetOptions = {},
    ): Promise<void> {
        if (typeof key !== 'string' || key.length === 0) {
            throw invalidArgument('setItem', 'key must be a non-empty string');
        }
        if (typeof value !== 'string') {
            throw invalidArgument(`setItem(${key})`, 'value must be a string');
        }
        unwrapAck(
            `setItem(${key})`,
            await callAsync<NativeResult>(MODULE, 'set', key, value, opts),
        );
    },

    /**
     * Read an encrypted string. Returns `null` if the key is not present.
     *
     * For keys stored with `requireBiometric: true`, the OS shows a prompt
     * before the value is returned. Pass `biometricPrompt.reason` to set
     * the displayed string; if omitted (or empty), a generic
     * "Authenticate to read secure data" default is used so the prompt
     * still appears.
     *
     * - **iOS**: `reason` is passed as `kSecUseOperationPrompt` on the
     *   Keychain query.
     * - **Android**: `reason` becomes the `BiometricPrompt` subtitle and
     *   `title` (or "Authenticate") becomes the prompt title.
     *
     * Dismissing that prompt throws (`… failed: userCancel`) — it is not the
     * same as `null`, which means the key isn't stored.
     */
    async getItem(key: string, opts: SecureStorageGetOptions = {}): Promise<string | null> {
        if (typeof key !== 'string' || key.length === 0) {
            throw invalidArgument('getItem', 'key must be a non-empty string');
        }
        const result = unwrapNative(
            PKG,
            `getItem(${key})`,
            await callAsync<NativeResult>(MODULE, 'get', key, opts),
        );
        return result?.value ?? null;
    },

    /** Remove a single key. No-op if the key doesn't exist. */
    async removeItem(key: string): Promise<void> {
        if (typeof key !== 'string' || key.length === 0) {
            throw invalidArgument('removeItem', 'key must be a non-empty string');
        }
        unwrapAck(
            `removeItem(${key})`,
            await callAsync<NativeResult>(MODULE, 'delete', key),
        );
    },

    /**
     * Delete every key owned by this module's service identifier. Does NOT
     * touch other apps' Keychain items, nor other Lynx packages'
     * SharedPreferences.
     */
    async clear(): Promise<void> {
        unwrapAck('clear', await callAsync<NativeResult>(MODULE, 'clear'));
    },

    /**
     * Check whether a key is present without decrypting it (no biometric
     * prompt). Safe to call on every render.
     */
    async hasKey(key: string): Promise<boolean> {
        if (typeof key !== 'string' || key.length === 0) {
            return false;
        }
        const result = unwrapNative(
            PKG,
            `hasKey(${key})`,
            await callAsync<NativeResult>(MODULE, 'hasKey', key),
        );
        return result?.exists === true;
    },

    /** Whether the native module is wired in the current build. */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
