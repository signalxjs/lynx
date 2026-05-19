# @sigx/lynx-camera

Photo capture via the system camera for sigx-lynx. iOS uses `UIImagePickerController`; Android uses an `ACTION_IMAGE_CAPTURE` intent fed by a `FileProvider` URI (the cache-path is wired by the app template's manifest).

## Install

```bash
pnpm add @sigx/lynx-camera
```

`sigx prebuild` auto-discovers the package, links the native module, injects `android.permission.CAMERA`, and adds the iOS usage descriptions:

- `NSCameraUsageDescription`
- `NSMicrophoneUsageDescription`
- `NSPhotoLibraryAddUsageDescription`

Override the prompts in your `signalx.config.ts` under `ios.usageDescriptions` if you want app-specific copy:

```ts
// signalx.config.ts
export default defineLynxConfig({
    ios: {
        usageDescriptions: {
            NSCameraUsageDescription: 'Acme uses the camera to scan QR codes.',
        },
    },
});
```

> **Android pairs with `@sigx/lynx-permissions`** — that's where the runtime permission prompt + Activity Result wiring lives. Install it (`pnpm add @sigx/lynx-permissions`) or rely on a sibling module that pulls it in transitively.

## Usage

```ts
import { Camera } from '@sigx/lynx-camera';

const { status } = await Camera.requestPermission();
if (status === 'granted') {
    const photo = await Camera.takePicture({ quality: 0.8, facing: 'back' });
    console.log(photo.uri, photo.width, photo.height);
}
```

## API

| Method                                                    | Notes                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `takePicture(options?: CameraOptions): Promise<PhotoResult>` | Opens the system camera. Returns the captured photo's file URI + dimensions. Throws if cancelled or denied.       |
| `requestPermission(): Promise<PermissionResponse>`        | Shows the OS permission dialog if needed. Re-call to surface the dialog again on first denial.                       |
| `getPermissionStatus(): Promise<PermissionResponse>`      | Read-only check — no prompt.                                                                                         |
| `isAvailable(): boolean`                                  | Whether the native module is registered in the current build.                                                        |

```ts
interface CameraOptions {
    facing?: 'front' | 'back';   // default: 'back'
    quality?: number;            // 0..1
    maxWidth?: number;           // pixels
    maxHeight?: number;          // pixels
}

interface PhotoResult {
    uri: string;        // file:// URI
    width: number;
    height: number;
    base64?: string;    // populated only if requested
}
```

## Gotchas

- **Android FileProvider** — the auto-injected `<provider>` in the app template's `AndroidManifest.xml` exposes the cache directory under `${applicationId}.fileprovider`. If you customize the manifest, keep that authority intact or the camera intent won't have a valid write target.
- **iOS simulator camera** — the simulator has a synthetic camera feed, not a real one. Test capture on a physical device.

## Reference app

`examples/lynx-one/my-sigx-app/src/cards/CameraCard.tsx` covers permission + capture + display flows end-to-end.
