# @sigx/lynx-secure-storage

Encrypted at-rest key-value storage for sigx-lynx — iOS Keychain, Android Keystore + `EncryptedSharedPreferences`.

For plaintext settings (theme, last-used tab, feature flags) use [`@sigx/lynx-storage`](https://sigx.dev/lynx/modules/storage/overview/). Use this package for **credentials, refresh tokens, PII, recovery keys** — anything that must survive a casual filesystem dump or backup exfiltration. Pairs with [`@sigx/lynx-biometric`](https://sigx.dev/lynx/modules/biometric/overview/) when you also need an explicit "unlock the app" gate; the `requireBiometric` option here gates the *individual key* via the OS Keychain / Keystore.

- **iOS**: `kSecClassGenericPassword` items via the Keychain Services API, with `kSecAccessControlBiometryCurrentSet` for biometric-gated keys and `…AfterFirstUnlockThisDeviceOnly` otherwise — items are never included in iCloud / iTunes backups.
- **Android**: AES-256-GCM via the Android Keystore. Non-biometric keys land in `EncryptedSharedPreferences`; biometric-gated keys use a per-key Keystore alias with `setUserAuthenticationRequired(true)` and a `BiometricPrompt.CryptoObject` on read.

## 📚 Documentation

Full API, biometric gating, threat model, Android backup setup and live examples → **[sigx.dev/lynx/modules/secure-storage/overview](https://sigx.dev/lynx/modules/secure-storage/overview/)**

## Install

```bash
pnpm add @sigx/lynx-secure-storage
```

`sigx prebuild` auto-discovers the package, links the native module, adds the `androidx.security` + `androidx.biometric` dependencies, and adds the `USE_BIOMETRIC` permission to the Android manifest.

## A taste

```ts
import { SecureStorage } from '@sigx/lynx-secure-storage';

// Plain encrypted set/get — no biometric prompt.
await SecureStorage.set('refresh_token', refreshToken);
const value = await SecureStorage.get('refresh_token');

// Biometric-gated key — reading it triggers Face ID / BiometricPrompt.
await SecureStorage.set('access_token', accessToken, { requireBiometric: true });
const token = await SecureStorage.get('access_token', {
    biometricPrompt: { reason: 'Unlock your account', title: 'Acme Bank' },
});
```

The full API (`hasKey`, `delete`, `clear`, `isAvailable`), the threat model, recipes for access/refresh-token flows, key-invalidation handling and the Android Auto Backup exclusion setup are on the docs site.

## License

MIT
