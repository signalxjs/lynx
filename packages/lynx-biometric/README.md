# @sigx/lynx-biometric

Biometric authentication for sigx-lynx — Face ID / Touch ID / Optic ID on iOS, `BiometricPrompt` (fingerprint, face, iris) on Android.

Pairs with [`@sigx/lynx-secure-storage`](https://sigx.dev/lynx/modules/secure-storage/overview/) when you also need to encrypt the credential at rest.

- **iOS**: `LAContext` / `LocalAuthentication.framework`.
- **Android**: `androidx.biometric.BiometricPrompt` + `BiometricManager`.

## 📚 Documentation

Full API, error codes, platform notes, threat model and live examples → **[sigx.dev/lynx/modules/biometric/overview](https://sigx.dev/lynx/modules/biometric/overview/)**

## Install

```bash
pnpm add @sigx/lynx-biometric
```

`sigx prebuild` auto-discovers the package, links the native module, adds `NSFaceIDUsageDescription` to iOS, and adds the `androidx.biometric` dependency plus `USE_BIOMETRIC` on Android. Customize the iOS usage description in `signalx.config.ts` — Apple rejects apps with a generic string.

## A taste

```ts
import { Biometric } from '@sigx/lynx-biometric';

// Check what the device supports — never prompts.
const { available, type } = await Biometric.isAvailable();
if (!available) return; // fall back to password

// Prompt the user. Always resolves — failures come back as { success: false }.
const result = await Biometric.authenticate({
    reason: 'Unlock your account',   // iOS localizedReason / Android subtitle
    title: 'Acme Bank',              // Android prompt title
    allowDeviceCredential: true,     // fall back to PIN/passcode/pattern
});

if (result.success) {
    // proceed
}
```

The full `BiometricType` / `BiometricErrorCode` reference, platform notes, troubleshooting and the threat model are documented on the docs site.

## License

MIT
