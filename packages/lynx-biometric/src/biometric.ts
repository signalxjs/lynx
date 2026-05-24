import { callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Biometric';

export type BiometricType =
    | 'faceId'
    | 'touchId'
    | 'fingerprint'
    | 'face'
    | 'iris'
    | 'none';

export interface BiometricAvailability {
    available: boolean;
    type: BiometricType;
}

export type BiometricErrorCode =
    | 'userCancel'
    | 'userFallback'
    | 'systemCancel'
    | 'authenticationFailed'
    | 'biometryNotAvailable'
    | 'biometryNotEnrolled'
    | 'biometryLockout'
    | 'noActivity'
    | 'unknown';

export interface BiometricAuthenticateOptions {
    /**
     * Reason shown to the user. iOS: `LAContext.localizedReason` (required by
     * the OS). Android: used as the prompt subtitle.
     */
    reason: string;
    /**
     * Android only. Title of the BiometricPrompt. Defaults to "Authenticate".
     * Ignored on iOS where the OS controls the title.
     */
    title?: string;
    /**
     * iOS only. `LAContext.localizedFallbackTitle` — text on the fallback
     * button (e.g. "Use Passcode"). Empty string hides it.
     */
    fallbackTitle?: string;
    /**
     * If true, the user can fall back to the device PIN/passcode/pattern when
     * biometrics fail or aren't enrolled. iOS: switches the policy to
     * `.deviceOwnerAuthentication`. Android: adds `DEVICE_CREDENTIAL` to
     * `setAllowedAuthenticators`.
     */
    allowDeviceCredential?: boolean;
}

export interface BiometricAuthenticateResult {
    success: boolean;
    /** Human-readable error message if `success` is false. */
    error?: string;
    /** Machine-readable error code if `success` is false. */
    errorCode?: BiometricErrorCode;
}

/**
 * Biometric authentication — Face ID / Touch ID on iOS, `BiometricPrompt`
 * (fingerprint, face, iris) on Android.
 *
 * @example
 * ```ts
 * import { Biometric } from '@sigx/lynx-biometric';
 *
 * const { available, type } = await Biometric.isAvailable();
 * if (!available) return;
 *
 * const result = await Biometric.authenticate({
 *     reason: 'Unlock your vault',
 *     fallbackTitle: 'Use Passcode',
 *     allowDeviceCredential: true,
 * });
 * if (result.success) {
 *     // proceed
 * }
 * ```
 */
export const Biometric = {
    /**
     * Check whether the device has biometric hardware enrolled and usable.
     * Never prompts the user.
     */
    isAvailable(): Promise<BiometricAvailability> {
        if (!isModuleAvailable(MODULE)) {
            return Promise.resolve({ available: false, type: 'none' });
        }
        return callAsync<BiometricAvailability>(MODULE, 'isAvailable');
    },

    /**
     * Prompt the user to authenticate. Always resolves — failures are
     * reported as `{ success: false, error, errorCode }` rather than
     * rejecting, so call sites don't need try/catch around the common
     * "user cancelled" case.
     */
    authenticate(
        opts: BiometricAuthenticateOptions,
    ): Promise<BiometricAuthenticateResult> {
        if (!opts || typeof opts.reason !== 'string' || opts.reason.length === 0) {
            return Promise.resolve({
                success: false,
                error: 'reason is required',
                errorCode: 'unknown',
            });
        }
        if (!isModuleAvailable(MODULE)) {
            return Promise.resolve({
                success: false,
                error: 'Biometric module not available in this build',
                errorCode: 'biometryNotAvailable',
            });
        }
        return callAsync<BiometricAuthenticateResult>(MODULE, 'authenticate', opts);
    },

    /** Whether the native module is wired in the current build. */
    isModuleAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
