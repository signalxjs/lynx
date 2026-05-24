# @sigx/lynx-biometric

Biometric authentication for sigx-lynx — Face ID / Touch ID / Optic ID on iOS, `BiometricPrompt` (fingerprint, face, iris) on Android.

Pairs with [`@sigx/lynx-secure-storage`](../lynx-secure-storage) when you also need to encrypt the credential at rest.

- **iOS**: `LAContext` / `LocalAuthentication.framework`.
- **Android**: `androidx.biometric.BiometricPrompt` + `BiometricManager` (`androidx.biometric:biometric:1.2.0-alpha05`).

## Install

```bash
pnpm add @sigx/lynx-biometric
```

`sigx prebuild` auto-discovers the package, links the native module, adds `NSFaceIDUsageDescription` to iOS `Info.plist`, and adds the `androidx.biometric` dependency plus `<uses-permission android:name="android.permission.USE_BIOMETRIC"/>` on Android.

> The default `NSFaceIDUsageDescription` ("Authenticate with Face ID to unlock the app.") is fine for most apps but should be customized — Apple rejects apps where this string is generic. Override in your `signalx.config.ts`:
>
> ```ts
> ios: {
>     usageDescriptions: {
>         NSFaceIDUsageDescription: 'Acme Bank uses Face ID to unlock your account.',
>     },
> }
> ```

## Usage

```ts
import { Biometric } from '@sigx/lynx-biometric';

// 1. Check what the device supports. Never prompts.
const { available, type } = await Biometric.isAvailable();
if (!available) {
    // Fall back to password / show "biometrics not set up" UI.
    return;
}

// 2. Prompt the user.
const result = await Biometric.authenticate({
    reason: 'Unlock your account',          // iOS localizedReason / Android subtitle
    title: 'Acme Bank',                     // Android prompt title (ignored on iOS)
    fallbackTitle: 'Use Passcode',          // iOS only — empty string hides it
    allowDeviceCredential: true,            // fall back to PIN/passcode/pattern
});

if (result.success) {
    // proceed
} else {
    // result.errorCode is one of:
    //   'userCancel' | 'userFallback' | 'systemCancel' |
    //   'authenticationFailed' | 'biometryNotAvailable' |
    //   'biometryNotEnrolled' | 'biometryLockout' | 'noActivity' | 'unknown'
}
```

`Biometric.authenticate` **always resolves** — failures (including the common "user cancelled") come back as `{ success: false, error, errorCode }`, so you don't need a try/catch.

## API

| Method | Returns |
|---|---|
| `Biometric.isAvailable()` | `Promise<{ available: boolean; type: BiometricType }>` |
| `Biometric.authenticate(opts)` | `Promise<{ success: boolean; error?: string; errorCode?: BiometricErrorCode }>` |
| `Biometric.isModuleAvailable()` | `boolean` — whether the native module is wired into the current build |

`BiometricType` is `'faceId' | 'touchId' | 'fingerprint' | 'face' | 'iris' | 'none'`. iOS maps `.faceID` → `'faceId'`, `.touchID` → `'touchId'`, `.opticID` → `'iris'`. Android maps fingerprint sensors → `'fingerprint'`; class-3 face sensors → `'face'`.

## Threat model

**Protects against:**
- Casual unauthorized access on an unlocked device.
- Shoulder-surfing of an OS-level passcode (biometric is presented instead).
- Sibling/co-worker who knows your PIN but can't pass the biometric check.

**Does NOT protect against:**
- A jailbroken or rooted device. `LAContext` / `BiometricPrompt` integrity assumes a trusted OS; on a compromised device the prompt itself can be bypassed.
- Identical twins (Face ID — Apple documents a higher false-accept rate).
- A determined attacker who knows your device PIN if `allowDeviceCredential: true` is set. Setting this option means "biometric OR passcode," which is a usability win but reduces the security gate to whatever the device passcode strength is.
- Memory inspection while the app is running. Once you've authenticated and read a secret from storage, the plaintext lives in the JS heap.

For "Strong" biometric class (Android `BIOMETRIC_STRONG`) the OS guarantees a false-accept rate ≤ 1/50,000. We always request `BIOMETRIC_STRONG`; weaker face unlock sensors that only meet `BIOMETRIC_WEAK` are reported as `available: false`.

## Reference

The showcase app's "Auth demo" screen (`examples/showcase/src/screens/AuthDemo.tsx`) demonstrates the full sign-in → biometric-unlock → secure-storage round-trip.
