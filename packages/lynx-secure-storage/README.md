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
await SecureStorage.setItem('refresh_token', refreshToken);
const value = await SecureStorage.getItem('refresh_token');

// Biometric-gated key — reading it triggers Face ID / BiometricPrompt.
await SecureStorage.setItem('access_token', accessToken, { requireBiometric: true });
const token = await SecureStorage.getItem('access_token', {
    biometricPrompt: { reason: 'Unlock your account', title: 'Acme Bank' },
});
```

The full API (`hasKey`, `removeItem`, `clear`, `isAvailable`), the threat model, recipes for access/refresh-token flows, key-invalidation handling and the Android Auto Backup exclusion setup are on the docs site.

## Web

**Not supported on web** (`sigx run:web`). There's no `.web.ts` implementation and `@sigx/lynx-web-host` exposes no secure-storage handler, so the `SecureStorage` native module is never registered: `isAvailable()` returns `false` and every call rejects with the `Module "SecureStorage" is not available` error.

Browsers have no OS-backed secret store equivalent to the Keychain / Keystore. The closest primitive a future shim could build on is a non-extractable WebCrypto `CryptoKey` held in IndexedDB — that keeps the raw key material out of reach of page script, but it is not hardware-backed and there is no biometric gate, so `requireBiometric` would have no analogue. For non-secret values, [`@sigx/lynx-storage`](https://sigx.dev/lynx/modules/storage/overview/) does ship a web implementation (IndexedDB) — but it is plaintext, so don't move credentials there.

## License

MIT
