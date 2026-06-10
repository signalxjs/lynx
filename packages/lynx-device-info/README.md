# @sigx/lynx-device-info
Device hardware + OS + screen + app metadata for sigx-lynx. One async call, all the fields.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/device-info/overview/](https://sigx.dev/lynx/modules/device-info/overview/)**

## Install
```bash
pnpm add @sigx/lynx-device-info
```
No special permissions — `sigx prebuild` auto-discovers and links the native module.
## Usage
```ts
import { DeviceInfo } from '@sigx/lynx-device-info';
const info = await DeviceInfo.getInfo();
console.log(info.model, info.systemVersion, info.screenWidth);
```
## API
| Method                                | Notes                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `getInfo(): Promise<DeviceInfoResult>` | Single async snapshot — values don't update reactively.                                            |
| `isAvailable(): boolean`              | Whether the native module is registered in the current build.                                      |
```ts
interface DeviceInfoResult {
    manufacturer: string;     // 'Apple', 'Google', 'samsung', etc.
    model: string;            // 'iPhone15,3' (raw model identifier on iOS), 'Pixel 9 Pro XL' on Android
    brand: string;            // iOS: same as manufacturer; Android: build brand
    systemName: string;       // 'iOS' | 'Android'
    systemVersion: string;    // '18.0' | '15'
    sdkVersion: number;       // iOS: major version int; Android: API level
    screenWidth: number;      // logical pixels (dp/pt)
    screenHeight: number;
    screenDensity: number;    // pixel ratio (e.g. 3 for @3x)
    appVersion: string;       // CFBundleShortVersionString / versionName
    appPackage: string;       // bundleIdentifier / applicationId
}
```
## Gotchas
- iOS `model` is the raw identifier (`iPhone15,3` = iPhone 15 Pro Max). If you want a friendly name, you'll need a lookup table or a third-party device database.
- `screenWidth`/`screenHeight` are logical (dp/pt). Multiply by `screenDensity` for raw pixels.
