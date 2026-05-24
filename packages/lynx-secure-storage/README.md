# @sigx/lynx-secure-storage

Encrypted at-rest key-value storage for sigx-lynx — iOS Keychain, Android Keystore + `EncryptedSharedPreferences`.

For plaintext settings (theme, last-used tab, feature flags) use [`@sigx/lynx-storage`](../lynx-storage). Use this package for **credentials, refresh tokens, PII, recovery keys** — anything that must survive a casual filesystem dump or backup exfiltration.

Pairs with [`@sigx/lynx-biometric`](../lynx-biometric) when you also need an explicit "unlock the app" gate; the `requireBiometric` option here gates the *individual key* via the OS Keychain / Keystore.

- **iOS**: `kSecClassGenericPassword` items via the Keychain Services API. `kSecAccessControlBiometryCurrentSet` for biometric-gated keys; `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` otherwise — items are never included in iCloud / iTunes backups.
- **Android**: AES-256-GCM via the Android Keystore. Non-biometric keys land in `EncryptedSharedPreferences` (`androidx.security:security-crypto`); biometric-gated keys use a per-key Keystore alias with `setUserAuthenticationRequired(true)` and a `BiometricPrompt.CryptoObject` on read.

## Install

```bash
pnpm add @sigx/lynx-secure-storage
```

`sigx prebuild` auto-discovers the package, links the native module, adds the `androidx.security` + `androidx.biometric` dependencies, and adds `<uses-permission android:name="android.permission.USE_BIOMETRIC"/>` to the Android manifest.

> **Android auto-backup**: `EncryptedSharedPreferences` files DO get included in Android Auto Backup by default. The data is encrypted, but the master key wraps to the device — restoring to a new device renders the encrypted blobs useless. For absolute safety, exclude the file from backup in your `backup_rules.xml`:
>
> ```xml
> <full-backup-content>
>     <exclude domain="sharedpref" path="sigx_secure_storage_v1.xml" />
> </full-backup-content>
> ```

## Usage

```ts
import { SecureStorage } from '@sigx/lynx-secure-storage';

// Plain encrypted set/get — no biometric prompt.
await SecureStorage.set('refresh_token', refreshToken);
const value = await SecureStorage.get('refresh_token');

// Biometric-gated key.
await SecureStorage.set('access_token', accessToken, { requireBiometric: true });

// Reading a biometric-gated key triggers Face ID / BiometricPrompt.
const token = await SecureStorage.get('access_token', {
    biometricPrompt: {
        reason: 'Unlock your account',   // iOS LAContext / Android subtitle
        title: 'Acme Bank',              // Android only — prompt title
    },
});

// Cheap existence check (never decrypts, never prompts).
if (await SecureStorage.hasKey('access_token')) { /* … */ }

// Per-key delete + namespaced clear.
await SecureStorage.delete('refresh_token');
await SecureStorage.clear();   // wipes only THIS module's items
```

`get`, `set`, `delete`, and `clear` reject on failure — wrap them in try/catch when handling user-driven cancels (e.g. user cancelled biometric prompt). `hasKey` only rejects on infrastructure failure.

## API

| Method | Returns |
|---|---|
| `SecureStorage.set(key, value, opts?)` | `Promise<void>` |
| `SecureStorage.get(key, opts?)` | `Promise<string \| null>` |
| `SecureStorage.delete(key)` | `Promise<void>` |
| `SecureStorage.clear()` | `Promise<void>` — only this module's keys |
| `SecureStorage.hasKey(key)` | `Promise<boolean>` — no prompt, no decrypt |
| `SecureStorage.isAvailable()` | `boolean` |

`set` options:
- `requireBiometric?: boolean` — gate this key with the OS biometric prompt.

`get` options:
- `biometricPrompt?: { reason: string; title?: string }` — required on Android when the key was stored with `requireBiometric: true`; the OS needs the strings to render `BiometricPrompt`. iOS uses `reason` as the LAContext `localizedReason`; if omitted the OS shows a generic default.

## Threat model

**Protects against:**
- Other apps reading the credential. Both Keychain (per-app entitlement) and Keystore (per-app alias namespace) enforce this at the OS level.
- Casual device theft if `requireBiometric: true` is used — the encrypted blob is on disk but the key requires user presence to unwrap.
- Backup exfiltration on iOS — all items use `…ThisDeviceOnly` accessibility, so they don't appear in iCloud or encrypted iTunes backups.
- Filesystem inspection (e.g. `adb pull`, jailbroken backup) on values that aren't biometric-gated, because `EncryptedSharedPreferences` and the Keychain blob are encrypted at rest with a hardware-backed key.

**Does NOT protect against:**
- A jailbroken / rooted device with a determined attacker — Keychain and Keystore can be dumped offline. `requireBiometric: true` raises the bar (the attacker also needs to bypass biometric auth or extract the key from the secure element), but does not eliminate the risk.
- Memory inspection while the app is running. Once `get` returns, the decrypted string lives in the JS heap.
- Screen scraping, accessibility tree leakage, or screen recording. If you display the secret in a `<TextInput>`, treat it as already-public.
- App-level data binding (state-management, dev-tools time-travel, error reporting). If you put the decrypted secret in a Redux store and ship Sentry breadcrumbs, you've leaked it.
- An attacker who knows the device PIN if they can also defeat the biometric (e.g. with a registered fingerprint). The OS treats biometric + passcode equivalently in `LAPolicy.deviceOwnerAuthentication` / Android `DEVICE_CREDENTIAL`.
- Android Auto Backup leaking non-biometric values to Google Drive unless you add an `<exclude>` rule (see Install). Biometric-gated values are bound to a Keystore alias that can't be restored to a different device.

For "Strong" guarantees we always request the strongest available biometric class (iOS `.biometryCurrentSet`; Android `BIOMETRIC_STRONG`). Weaker face unlock sensors that don't meet `BIOMETRIC_STRONG` are reported as unavailable rather than silently downgraded.

## Reference

The showcase app's "Auth demo" screen (`examples/showcase/src/screens/AuthDemo.tsx`) demonstrates the full sign-in → encrypted store → biometric unlock → reveal flow.
