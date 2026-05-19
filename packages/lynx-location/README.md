# @sigx/lynx-location

GPS / network location for sigx-lynx. `CLLocationManager` on iOS, `FusedLocationProviderClient` on Android.

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

> **Android pairs with `@sigx/lynx-permissions`** — needed for the runtime permission prompt.

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

## Gotchas

- **Background location isn't supported here.** This module is `WhenInUse`-only; if you need `Always` access (geofencing, background tracking), the native side needs additional setup not in this package.
- **iOS simulator location** — set a fake location in the simulator's **Features → Location** menu, otherwise `getCurrentPosition()` hangs until timeout.
- **Accuracy is a hint.** `'high'` requests `kCLLocationAccuracyBest` / `Priority.HIGH_ACCURACY`. Actual returned `accuracy` (meters) reflects what the device managed.

## Reference app

`examples/lynx-one/my-sigx-app/src/cards/LocationCard.tsx` covers permission + one-shot fix + display.
