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

### `BiometricType`

| Value | iOS | Android |
|---|---|---|
| `'faceId'` | `LABiometryType.faceID` | — |
| `'touchId'` | `LABiometryType.touchID` | — |
| `'iris'` | `LABiometryType.opticID` (Vision Pro) | iris sensor (rare) |
| `'fingerprint'` | — | fingerprint sensor |
| `'face'` | — | class-3 face sensor |
| `'none'` | no enrolled biometric / no hardware | no enrolled biometric / no hardware |

### `BiometricErrorCode`

| Code | When | Notes |
|---|---|---|
| `'userCancel'` | User tapped Cancel / negative button. | The friendly path — usually no UI is needed. |
| `'userFallback'` | iOS only. User tapped the `fallbackTitle` button. | Caller should present their own fallback (e.g. PIN entry). |
| `'systemCancel'` | OS dismissed the prompt (incoming call, app backgrounded, foregrounded another app). | Safe to retry. |
| `'authenticationFailed'` | Biometric matched no enrolled identity. | User can retry; only emitted on the terminal failure. |
| `'biometryNotAvailable'` | No hardware, no passcode set, or the module is missing from this build. | Fall back to password-based auth. |
| `'biometryNotEnrolled'` | Hardware exists but the user hasn't enrolled. | Deep-link to system settings if you want them to enrol. |
| `'biometryLockout'` | Too many failed attempts. | iOS requires the device passcode to unlock; Android either timed-lockout or `LOCKOUT_PERMANENT`. |
| `'noActivity'` | Android only. The host `FragmentActivity` wasn't in the foreground. | Indicates a wiring bug — shouldn't reach end users. |
| `'unknown'` | Anything else, including bridge-level failures. | Inspect `error` for details. |

### Platform notes

**Android API 28/29 (Android 9/10).** `allowDeviceCredential: true` still enables the PIN/passcode fallback on these versions, but via the deprecated `setDeviceCredentialAllowed(true)` API — the modern `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` combo is rejected by Keystore prior to API 30. Behaviour from the caller's perspective is identical: tapping the negative-button area surfaces the device credential prompt.

**iOS Optic ID.** Reported as `'iris'` for cross-platform symmetry — the `Biometric.authenticate` flow is unchanged.

## Troubleshooting

**Face ID never prompts in the iOS simulator.** Simulators ship with biometrics *disabled*. Enrol via `Features → Face ID → Enrolled`, then trigger your `authenticate` call and use `Features → Face ID → Matching Face` / `Non-matching Face` to simulate the user response. Same flow for Touch ID. On a real device, biometrics are always enrolled at the OS level — you'd never hit this.

**Android prompt never appears.** Two common causes:
1. **Wrong activity class.** `BiometricPrompt` requires a `FragmentActivity`. The package's `BiometricActivityHook` only captures the host when it's a `FragmentActivity` — if your `MainActivity` extends plain `Activity`, the prompt has nothing to attach to and `authenticate` returns `errorCode: 'noActivity'`. Switch your host to `FragmentActivity` (or `AppCompatActivity`, which inherits from it).
2. **`canAuthenticate` reports a non-success status.** `BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG)` can return `BIOMETRIC_ERROR_HW_UNAVAILABLE` (hardware temporarily unavailable, e.g. on a locked Pixel sensor), `BIOMETRIC_ERROR_NONE_ENROLLED` (no fingerprint registered), or `BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED` (a known Pixel quirk after security patches). The module surfaces these via `Biometric.isAvailable()` returning `{ available: false, type: 'none' }`.

**`biometryLockout` on iOS won't clear.** After 5 failed attempts iOS demands the device passcode before biometric auth is usable again. Show a "Use Passcode" fallback (`allowDeviceCredential: true`) or wait for the user to unlock the device.

**Permission dialog never shows on Android.** `USE_BIOMETRIC` is a normal-protection permission (auto-granted at install time on API 28+) — there is no runtime prompt and no `requestPermission()` call needed.

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
