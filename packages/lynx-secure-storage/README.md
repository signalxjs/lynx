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

## Gotchas

- **Failures reject; they are never returned as data.** Every async method throws a `SigxError` — always with a `code`, so you branch on that rather than the message:

  | `code` | When | Message |
  | --- | --- | --- |
  | `'invalid_argument'` | An empty/non-string key, or a non-string value | `[@sigx/lynx-secure-storage] <method> failed: key must be a non-empty string` — the key is left out of the prefix here, because it is the thing that was wrong. A bad *value* still names the key: `setItem(<key>) failed: value must be a string` |
  | `'module_unavailable'` | The native module isn't linked into the build — raised by core's `getModule`, so `.package` is `lynx-core` | `[@sigx/lynx-core] Module "SecureStorage" is not available. …` |
  | `'native_error'` | The platform reported a failure | `[@sigx/lynx-secure-storage] <method>(<key>) failed: <native message>`, raw native payload on `cause` |

  `hasKey` is the one exception, and only on the first row: it is a predicate, so an unusable key resolves `false` rather than throwing — the same answer it gives for a key that was never stored. It still throws the other two.

  The natives resolve their callback with `{ error }` rather than rejecting, so unwrapping that envelope is what stands between a failed read and a plausible-looking `null`. Previously these were plain `Error`s with a hand-rolled prefix: no `code` to branch on and no `cause`, so the native payload was lost at the throw. Prefer `isAvailable()` over catching `'module_unavailable'` — a build without the module never recovers at runtime.
- **A gated read authenticates by itself — don't prompt twice.** `getItem` on a key stored with `requireBiometric: true` puts up the OS prompt as part of decrypting it. Calling `Biometric.authenticate()` first and *then* reading asks the user for the same thing twice; reach for `@sigx/lynx-biometric` on its own only when there is no gated key behind the check.
- **Android wraps rather than encrypts directly.** A key marked `setUserAuthenticationRequired(true)` needs a fresh authentication for *every* operation if it is symmetric — encryption included — so the value is encrypted with a one-shot AES key that is then wrapped by an auth-bound Keystore **RSA** public key. Writing therefore never prompts (matching iOS), and only the unwrap on read does. Two consequences worth knowing: the stored blob is a little larger than the plaintext, and a key whose biometric enrolment changes invalidates the RSA pair, so the value must be written again.
- **A dismissed biometric prompt is a rejection, not `null`.** There is no `{ cancelled: true }` result here: both platforms report a dismiss as `{ error: 'userCancel' }` (iOS `errSecUserCanceled`, Android `ERROR_NEGATIVE_BUTTON`), so it throws `… failed: userCancel` like any other native failure. `null` means one thing only — the key was never stored. Match on the message to treat a dismiss as ordinary; a stable `code` for it is tracked in [#903](https://github.com/signalxjs/lynx/issues/903).
- **A write that native doesn't acknowledge throws.** `setItem` / `removeItem` / `clear` require `{ ok: true }` back; a payload carrying neither `ok` nor `error` is treated as a write that never happened rather than reported as stored, because a credential that silently isn't there is the worst way this package can be wrong.

## License

MIT
