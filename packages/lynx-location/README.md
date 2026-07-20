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
## API
| Method                                                       | Notes                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `getCurrentPosition(options?: LocationOptions): Promise<LocationResult>` | One-shot fix. Throws on timeout or denied.                                                |
| `requestPermission(): Promise<PermissionResponse>`           | Shows the OS permission dialog if needed.                                                          |
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
