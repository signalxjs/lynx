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
import { isSigxError } from '@sigx/lynx-core';
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
        // Failure (permission denied, no camera, …) rejects with a SigxError.
        if (isSigxError(e)) console.warn(e.code, e.message);
    }
}
```

Each capture has **three outcomes**: it resolves with a result (always carrying a
`uri`), resolves with `{ cancelled: true }` (no `uri`) if the user dismisses the
camera, or **throws** on failure. Narrow on `result.uri` and wrap in `try/catch`.

Failures throw core's [`SigxError`](https://sigx.dev/lynx/modules/core/overview/)
with `code: 'native_error'` and a message of the form
`[@sigx/lynx-camera] takePicture failed: <native message>` — native reports them
on the *resolved* callback, so without this unwrap a caller's `try/catch` would
never fire and every failure would read as a cancel.

## API
| Method                                                    | Notes                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `takePicture(options?: CameraOptions): Promise<PhotoResult \| CameraCancelled>` | Opens the system camera in photo mode. Resolves with the captured photo's URI (plus dimensions where available — iOS only), or `{ cancelled: true }` on cancel; throws on failure. |
| `recordVideo(options?: CameraVideoOptions): Promise<VideoResult \| CameraCancelled>` | Opens the system camera in video mode. Resolves with the recorded clip's URI (`file://` on iOS, `content://` on Android) loadable by `@sigx/lynx-video`, or `{ cancelled: true }` on cancel; throws on failure. |
| `requestPermission(): Promise<PermissionResponse>`        | Shows the OS permission dialog if needed. Re-call to surface the dialog again on first denial.                       |
| `getPermissionStatus(): Promise<PermissionResponse>`      | Read-only check — no prompt.                                                                                         |
| `isAvailable(): boolean`                                  | Whether the native module is registered in the current build.                                                        |

```ts
interface CameraOptions {        // Android's intent ignores all of these
    facing?: 'front' | 'back';   // iOS only; default: 'back'
    quality?: number;            // iOS only; 0..1 (default 0.8)
    maxWidth?: number;           // reserved — not yet applied on either platform
    maxHeight?: number;          // reserved — not yet applied on either platform
}
interface PhotoResult {
    uri: string;        // file:// (iOS) or content:// (Android)
    width?: number;     // iOS only — Android's intent doesn't report dimensions
    height?: number;    // iOS only
    fileSize?: number;  // iOS only
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
## Web
**Not supported on web** (`sigx run:web`). `@sigx/lynx-web-host` exposes no `sigx.camera.*` handler and this package ships no `.web.ts`, so the `Camera` module isn't registered in a web build: `isAvailable()` returns `false`, and the capture and permission methods all reject with core's `Module "Camera" is not available` error.

Use [`@sigx/lynx-image-picker`](https://sigx.dev/lynx/modules/image-picker/overview/) instead — its web implementation routes through the page bridge to a hidden `<input type="file">` and hands back `blob:` URLs for photos and videos the user selects (the browser's own chooser is where a mobile user reaches their camera). Live in-app capture would need a future shim over `navigator.mediaDevices.getUserMedia`; nothing wires that today.
## Gotchas
- **Permission is auto-requested** — `takePicture` / `recordVideo` request the camera permission for you before opening the camera (iOS via `AVCaptureDevice`; Android via the runtime `CAMERA` prompt, plus microphone for `recordVideo` when the app declares `RECORD_AUDIO`). Calling `requestPermission()` first is optional — useful only to gate UI on the status ahead of time. On Android it's also *required* internally: the manifest declares `CAMERA`, and the OS refuses `ACTION_IMAGE_CAPTURE` / `ACTION_VIDEO_CAPTURE` unless it's been granted.
- **A cancel is not an error** — dismissing the camera always resolves `{ cancelled: true }`, on both platforms, even though Android signals it *through* the error field (`"cancelled"`, `"cancelled by new takePicture"`, `"activity destroyed"`) and sets `cancelled: true` on genuine failures too. Only those sentinels resolve; everything else on the error field throws. Don't branch on a `cancelled` property of your own — narrow on `result.uri`.
- **Android FileProvider** — the auto-injected `<provider>` in the app template's `AndroidManifest.xml` exposes the cache directory under `${applicationId}.fileprovider`. If you customize the manifest, keep that authority intact or the camera intent won't have a valid write target.
- **iOS simulator camera** — the simulator has no real camera, so `takePicture` / `recordVideo` report "Camera not available". Test capture on a physical device.
- **Options are honored on iOS only** — Android delegates to the system camera intent, which ignores `CameraOptions` / `CameraVideoOptions` entirely (the user can still switch cameras in its UI; just don't rely on `facing` to pick one programmatically on Android). On iOS, `facing`, `quality`, and `maxDurationMs` (video) are applied; `maxWidth` / `maxHeight` are reserved and **not yet applied on either platform**.
- **A single in-camera photo/video toggle** (one screen, switch mode in-camera) is iOS-only at the system level; Android has separate photo/video intents. Present your own chooser (Take Photo / Record Video) for a consistent cross-platform flow — see `examples/showcase`'s `MediaCaptureCard`. An iOS-native `capture({ mediaType: 'mixed' })` toggle may be added later.

## License

MIT
