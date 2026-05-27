# @sigx/lynx-secure-storage

Encrypted at-rest key-value storage for sigx-lynx — iOS Keychain, Android Keystore + `EncryptedSharedPreferences`.

For plaintext settings (theme, last-used tab, feature flags) use [`@sigx/lynx-storage`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-storage). Use this package for **credentials, refresh tokens, PII, recovery keys** — anything that must survive a casual filesystem dump or backup exfiltration.

Pairs with [`@sigx/lynx-biometric`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-biometric) when you also need an explicit "unlock the app" gate; the `requireBiometric` option here gates the *individual key* via the OS Keychain / Keystore.

- **iOS**: `kSecClassGenericPassword` items via the Keychain Services API. `kSecAccessControlBiometryCurrentSet` for biometric-gated keys; `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` otherwise — items are never included in iCloud / iTunes backups.
- **Android**: AES-256-GCM via the Android Keystore. Non-biometric keys land in `EncryptedSharedPreferences` (`androidx.security:security-crypto`); biometric-gated keys use a per-key Keystore alias with `setUserAuthenticationRequired(true)` and a `BiometricPrompt.CryptoObject` on read.

## Install

```bash
pnpm add @sigx/lynx-secure-storage
```

`sigx prebuild` auto-discovers the package, links the native module, adds the `androidx.security` + `androidx.biometric` dependencies, and adds `<uses-permission android:name="android.permission.USE_BIOMETRIC"/>` to the Android manifest.

### Android Auto Backup

`EncryptedSharedPreferences` files are included in Android Auto Backup by default. The data is encrypted but the master key is device-bound, so restoring to a new device produces unreadable blobs that the next `get()` call will fail on. **Recommended:** exclude both of this module's prefs files from backup.

Create `android/app/src/main/res/xml/sigx_backup_rules.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="sharedpref" path="sigx_secure_storage_v1.xml" />
    <exclude domain="sharedpref" path="sigx_secure_storage_biometric_v1.xml" />
</full-backup-content>
```

And the Android 12+ equivalent at `android/app/src/main/res/xml/sigx_data_extraction_rules.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="sharedpref" path="sigx_secure_storage_v1.xml" />
        <exclude domain="sharedpref" path="sigx_secure_storage_biometric_v1.xml" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="sharedpref" path="sigx_secure_storage_v1.xml" />
        <exclude domain="sharedpref" path="sigx_secure_storage_biometric_v1.xml" />
    </device-transfer>
</data-extraction-rules>
```

Wire both in your `AndroidManifest.xml`'s `<application>` element:

```xml
<application
    android:fullBackupContent="@xml/sigx_backup_rules"
    android:dataExtractionRules="@xml/sigx_data_extraction_rules"
    …>
```

Biometric-gated keys are intrinsically safe — the Keystore alias can't be restored to a different device — but the encrypted blob's still useless on restore, so excluding both files keeps the user out of a confusing "stale ciphertext" state.

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
- `biometricPrompt?: { reason: string; title?: string }` — strings shown on the OS prompt for biometric-gated keys. If omitted (or `reason` is empty), a generic `"Authenticate to read secure data"` default is used so the prompt still appears with a non-blank subtitle. On iOS the `reason` is passed via `kSecUseOperationPrompt`; on Android it becomes the `BiometricPrompt` subtitle.

## Recipes

### Access token + refresh token

The common shape: a long-lived **refresh** token (no biometric gate, used at app start to mint a new access token) plus a short-lived **access** token (biometric-gated, read on every sensitive request).

```ts
import { SecureStorage } from '@sigx/lynx-secure-storage';

async function onLoginSuccess(accessToken: string, refreshToken: string) {
    // Refresh token: needed silently on cold start, so no prompt.
    await SecureStorage.set('refresh_token', refreshToken);
    // Access token: short-lived, prompt every time it's read.
    await SecureStorage.set('access_token', accessToken, { requireBiometric: true });
}

async function getAccessTokenWithPrompt(): Promise<string | null> {
    return SecureStorage.get('access_token', {
        biometricPrompt: { reason: 'Unlock your account', title: 'Acme Bank' },
    });
}

async function silentRefresh(): Promise<string | null> {
    // No prompt — refresh_token has no requireBiometric flag.
    return SecureStorage.get('refresh_token');
}

async function logout() {
    await SecureStorage.delete('access_token');
    await SecureStorage.delete('refresh_token');
}
```

### Handle key invalidation after biometric enrollment changes

Both platforms invalidate biometric-gated keys when the user adds or removes a biometric (iOS: `.biometryCurrentSet`; Android: `setInvalidatedByBiometricEnrollment(true)`). The stored blob remains on disk but `get()` rejects because the underlying key is gone. Treat this as "the user needs to sign in again":

```ts
async function readAccessToken(): Promise<string | null> {
    try {
        return await SecureStorage.get('access_token', {
            biometricPrompt: { reason: 'Unlock your account' },
        });
    } catch (err) {
        const msg = (err as Error).message;
        // Android surfaces the underlying KeyPermanentlyInvalidatedException
        // through the native error message we wrap as "Cipher init failed
        // (key may be invalidated)". Detect it by substring.
        const androidInvalidated =
            /may be invalidated|KeyPermanentlyInvalidated/i.test(msg);
        if (androidInvalidated) {
            await SecureStorage.delete('access_token');
            return null;   // app should send the user back to sign-in
        }
        throw err;
    }
}
```

**iOS caveat.** On iOS the Keychain returns `errSecAuthFailed` for both genuine biometric mismatch and "the biometric set changed since this item was stored" — the JS surface currently normalises both to `authenticationFailed`, so they can't be told apart from JS alone. Recommended approach: if `get()` for a biometric-gated key rejects with `authenticationFailed` and the user just retried, treat it the same as the Android invalidation path (delete + re-auth) rather than looping. A future module version will expose a richer `errorCode` field so the two cases can be distinguished cleanly.

The same delete-then-re-auth pattern applies when the user disables biometrics entirely between launches.

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
