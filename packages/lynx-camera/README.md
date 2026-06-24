# @sigx/lynx-camera
Photo & video capture via the system camera for sigx-lynx. iOS uses `UIImagePickerController`; Android uses an `ACTION_IMAGE_CAPTURE` / `ACTION_VIDEO_CAPTURE` intent fed by a `FileProvider` URI (the cache-path is wired by the app template's manifest).

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/camera/overview/](https://sigx.dev/lynx/modules/camera/overview/)**

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
On Android the runtime permission prompt + Activity Result wiring comes from [`@sigx/lynx-permissions`](https://sigx.dev/lynx/modules/permissions/overview/), a dependency of this package — the auto-linker pulls it in, nothing to install.
## Usage
```ts
import { Camera } from '@sigx/lynx-camera';
const { status } = await Camera.requestPermission();
if (status === 'granted') {
    try {
        const photo = await Camera.takePicture({ quality: 0.8, facing: 'back' });
        if (photo.uri) console.log(photo.uri, photo.width, photo.height);
        // else: the user cancelled (resolves with `{ cancelled: true }`)

        // Record a clip — the returned URI loads directly in @sigx/lynx-video.
        const clip = await Camera.recordVideo({ maxDurationMs: 30_000 });
        if (clip.uri) console.log(clip.uri, clip.durationMs);
    } catch (e) {
        // Failure (permission denied, no camera, …) rejects.
        console.warn('capture failed:', e);
    }
}
```

Each capture has **three outcomes**: it resolves with a result (always carrying a
`uri`), resolves with `{ cancelled: true }` (no `uri`) if the user dismisses the
camera, or **throws** on failure. Narrow on `result.uri` and wrap in `try/catch`.

## API
| Method                                                    | Notes                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `takePicture(options?: CameraOptions): Promise<PhotoResult \| CameraCancelled>` | Opens the system camera in photo mode. Resolves with the captured photo's URI + dimensions, or `{ cancelled: true }` on cancel; throws on failure. |
| `recordVideo(options?: CameraVideoOptions): Promise<VideoResult \| CameraCancelled>` | Opens the system camera in video mode. Resolves with the recorded clip's URI (`file://` on iOS, `content://` on Android) loadable by `@sigx/lynx-video`, or `{ cancelled: true }` on cancel; throws on failure. |
| `requestPermission(): Promise<PermissionResponse>`        | Shows the OS permission dialog if needed. Re-call to surface the dialog again on first denial.                       |
| `getPermissionStatus(): Promise<PermissionResponse>`      | Read-only check — no prompt.                                                                                         |
| `isAvailable(): boolean`                                  | Whether the native module is registered in the current build.                                                        |

```ts
interface CameraOptions {       // all iOS-only — Android's intent ignores options
    facing?: 'front' | 'back';   // default: 'back'
    quality?: number;            // 0..1
    maxWidth?: number;           // pixels
    maxHeight?: number;          // pixels
}
interface PhotoResult {
    uri: string;        // file:// (iOS) or content:// (Android)
    width: number;
    height: number;
    base64?: string;    // populated only if requested
}
interface CameraVideoOptions {  // all iOS-only — Android's intent ignores options
    facing?: 'front' | 'back';   // default: 'back'
    maxDurationMs?: number;      // iOS only — Android's intent has no duration cap
}
interface VideoResult {
    uri: string;          // file:// (iOS) or content:// (Android)
    durationMs?: number;  // reported where the platform provides it
    width?: number;
    height?: number;
    fileSize?: number;
}
interface CameraCancelled {
    cancelled: true;
    uri?: undefined;      // present so callers can narrow on `result.uri`
}
```
## Gotchas
- **Android FileProvider** — the auto-injected `<provider>` in the app template's `AndroidManifest.xml` exposes the cache directory under `${applicationId}.fileprovider`. If you customize the manifest, keep that authority intact or the camera intent won't have a valid write target.
- **iOS simulator camera** — the simulator has no real camera, so `takePicture` / `recordVideo` report "Camera not available". Test capture on a physical device.
- **Capture options are iOS-only** — Android delegates to the system camera intent, which ignores `CameraOptions` / `CameraVideoOptions` entirely (`facing`, `quality`, `maxWidth`/`maxHeight`, `maxDurationMs`). The user can still switch cameras in the system UI; just don't rely on `facing` to pick one programmatically on Android.
- **A single in-camera photo/video toggle** (one screen, switch mode in-camera) is iOS-only at the system level; Android has separate photo/video intents. Present your own chooser (Take Photo / Record Video) for a consistent cross-platform flow — see `examples/showcase`'s `MediaCaptureCard`. An iOS-native `capture({ mediaType: 'mixed' })` toggle may be added later.
