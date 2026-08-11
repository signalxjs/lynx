# @sigx/lynx-location
GPS / network location for sigx-lynx. `CLLocationManager` on iOS, `FusedLocationProviderClient` on Android.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/location/overview/](https://sigx.dev/lynx/modules/location/overview/)**

## Install
```bash
pnpm add @sigx/lynx-location
```
`sigx prebuild` auto-discovers the package, links the native module, adds the iOS usage descriptions:
- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
…and the Android permissions:
- `ACCESS_FINE_LOCATION`
- `ACCESS_COARSE_LOCATION`
On Android the runtime permission prompt comes from [`@sigx/lynx-permissions`](https://sigx.dev/lynx/modules/permissions/overview/), a dependency of this package — the auto-linker pulls it in, nothing to install.
## Usage
```ts
import { Location } from '@sigx/lynx-location';
const { status } = await Location.requestPermission();
if (status === 'granted') {
    const loc = await Location.getCurrentPosition({ accuracy: 'high', timeout: 10000 });
    console.log(loc.latitude, loc.longitude, loc.accuracy);
}
```
**Failures reject.** When the platform can't answer — permission not granted, no fix available, a native exception — the call rejects. On iOS and Android that's a `SigxError` (`code: 'native_error'`, message `[@sigx/lynx-location] <method> failed: <native message>`); on web the host bridge rejects with the browser's geolocation error. A *denied permission* is not a failure: `requestPermission()` / `getPermissionStatus()` resolve normally with `status: 'denied'` or `'blocked'`, which is what you branch on. If the native module isn't linked at all, every method throws the descriptive error from core naming the missing module — feature-detect with `isAvailable()` rather than catching.

⚠️ **iOS doesn't honour that status union yet.** On the first run — the only run where the prompt appears — `requestPermission()` resolves `{ status: 'requesting' }`, which is not a `PermissionStatus`, and the real answer never arrives: the module implements no `locationManagerDidChangeAuthorization`. iOS can also report `'restricted'` and `'unknown'`. So `status === 'granted'` is always false on first run, and an exhaustive `switch` can fall through. Until [#889](https://github.com/signalxjs/lynx/issues/889) lands the delegate callback and the status mapping, poll `getPermissionStatus()` after prompting until it leaves `'requesting'`, and treat any unrecognized status as "not granted".
## API
| Method                                                       | Notes                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `getCurrentPosition(options?: LocationOptions): Promise<LocationResult>` | One-shot fix. Rejects when the platform reports a failure.                                |
| `requestPermission(): Promise<PermissionResponse>`           | Shows the OS permission dialog if needed. A denial resolves, it doesn't reject.                    |
| `getPermissionStatus(): Promise<PermissionResponse>`         | Read-only check — no prompt.                                                                       |
| `isAvailable(): boolean`                                     | Whether the native module is registered in the current build.                                      |
```ts
interface LocationOptions {
    accuracy?: 'high' | 'balanced' | 'low';   // default: 'balanced'
    timeout?: number;                          // ms; default platform-specific
}
interface LocationResult {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;       // meters
    speed: number | null;   // m/s
    heading: number | null; // degrees
    timestamp: number;      // epoch ms
}
```
## Web

On web the same API routes through the `@sigx/lynx-web-host` page bridge to `navigator.geolocation` and the Permissions API. Geolocation requires a secure context (localhost/HTTPS). A browser denial reports `status: 'blocked'` with `canAskAgain: false` — the user must change the site setting; there is no re-prompt. `requestPermission()` surfaces the browser prompt by issuing a position request (browsers have no standalone geolocation prompt).

## Gotchas
- **Background location isn't supported here.** This module is `WhenInUse`-only; if you need `Always` access (geofencing, background tracking), the native side needs additional setup not in this package.
- **iOS simulator location** — set a fake location in the simulator's **Features → Location** menu, otherwise `getCurrentPosition()` hangs until timeout.
- **Accuracy is a hint.** `'high'` requests `kCLLocationAccuracyBest` / `Priority.HIGH_ACCURACY`. Actual returned `accuracy` (meters) reflects what the device managed.
