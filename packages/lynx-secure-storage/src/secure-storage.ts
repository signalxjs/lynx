import { callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'SecureStorage';

// The JS surface is setItem/getItem/removeItem (matching @sigx/lynx-storage,
// localStorage and expo-secure-store); the native wire names stay set/get/
// delete. That asymmetry is deliberate — the wire name isn't public API, and
// renaming it would churn Swift, Kotlin and the manifest for no caller benefit.
// Don't "fix" it.

export interface SecureStorageSetOptions {
    /**
     * When true, the OS will require biometric authentication on every
     * subsequent `get` of this key.
     *
     * - iOS: stored with `kSecAccessControlBiometryCurrentSet`. The OS shows
     *   the Face ID / Touch ID prompt automatically inside the Keychain
     *   query — no extra JS call is needed.
     * - Android: the key is generated with
     *   `setUserAuthenticationRequired(true)`. `get` must drive a
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

function unwrap(result: NativeResult | null | undefined, action: string): void {
    if (!result || result.error) {
        throw new Error(
            `[@sigx/lynx-secure-storage] ${action} failed: ${result?.error ?? 'unknown error'}`,
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
     * Setting `requireBiometric: true` makes future `get` calls prompt for
     * biometrics; the `set` call itself never prompts.
     */
    async setItem(
        key: string,
        value: string,
        opts: SecureStorageSetOptions = {},
    ): Promise<void> {
        if (typeof key !== 'string' || key.length === 0) {
            throw new Error('[@sigx/lynx-secure-storage] key must be a non-empty string');
        }
        if (typeof value !== 'string') {
            throw new Error('[@sigx/lynx-secure-storage] value must be a string');
        }
        const result = await callAsync<NativeResult>(MODULE, 'set', key, value, opts);
        unwrap(result, `setItem(${key})`);
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
     */
    async getItem(key: string, opts: SecureStorageGetOptions = {}): Promise<string | null> {
        if (typeof key !== 'string' || key.length === 0) {
            throw new Error('[@sigx/lynx-secure-storage] key must be a non-empty string');
        }
        const result = await callAsync<NativeResult>(MODULE, 'get', key, opts);
        if (result?.error) {
            throw new Error(
                `[@sigx/lynx-secure-storage] getItem(${key}) failed: ${result.error}`,
            );
        }
        return result?.value ?? null;
    },

    /** Remove a single key. No-op if the key doesn't exist. */
    async removeItem(key: string): Promise<void> {
        if (typeof key !== 'string' || key.length === 0) {
            throw new Error('[@sigx/lynx-secure-storage] key must be a non-empty string');
        }
        const result = await callAsync<NativeResult>(MODULE, 'delete', key);
        unwrap(result, `removeItem(${key})`);
    },

    /**
     * Delete every key owned by this module's service identifier. Does NOT
     * touch other apps' Keychain items, nor other Lynx packages'
     * SharedPreferences.
     */
    async clear(): Promise<void> {
        const result = await callAsync<NativeResult>(MODULE, 'clear');
        unwrap(result, 'clear');
    },

    /**
     * Check whether a key is present without decrypting it (no biometric
     * prompt). Safe to call on every render.
     */
    async hasKey(key: string): Promise<boolean> {
        if (typeof key !== 'string' || key.length === 0) {
            return false;
        }
        const result = await callAsync<NativeResult>(MODULE, 'hasKey', key);
        if (result?.error) {
            throw new Error(
                `[@sigx/lynx-secure-storage] hasKey(${key}) failed: ${result.error}`,
            );
        }
        return result?.exists === true;
    },

    /** Whether the native module is wired in the current build. */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
