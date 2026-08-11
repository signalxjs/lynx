# @sigx/lynx-image-picker
Pick photos and videos from the system gallery for sigx-lynx. iOS uses `PHPickerViewController` (iOS 14+) / `UIImagePickerController` (older); Android uses the system photo picker (Android 13+) / `ACTION_OPEN_DOCUMENT` (older).

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/image-picker/overview/](https://sigx.dev/lynx/modules/image-picker/overview/)**

## Install
```bash
pnpm add @sigx/lynx-image-picker
```
`sigx prebuild` auto-discovers the package, links the native module, injects the iOS `NSPhotoLibraryUsageDescription`, and adds the Android media-read permissions:
- `READ_MEDIA_IMAGES`
- `READ_MEDIA_VIDEO`
- `READ_EXTERNAL_STORAGE` (older API levels)
On Android the Activity Result wiring comes from [`@sigx/lynx-permissions`](https://sigx.dev/lynx/modules/permissions/overview/), a dependency of this package — the auto-linker pulls it in, nothing to install.
## Usage
```ts
import { ImagePicker } from '@sigx/lynx-image-picker';
const { status } = await ImagePicker.requestPermission();
if (status === 'granted') {
    const result = await ImagePicker.pickImage({ quality: 0.8 });
    if (!result.cancelled) {
        for (const asset of result.assets) {
            console.log(asset.uri, asset.width, asset.height);
        }
    }
}
// Multi-select
const many = await ImagePicker.pickImage({ multiple: true, maxItems: 5 });
// Video
const vid = await ImagePicker.pickVideo();
```
## API
| Method                                                          | Notes                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pickImage(options?: ImagePickerOptions): Promise<ImagePickerResult>` | Photo picker — `mediaType` defaults to `'photo'`.                                              |
| `pickVideo(options?: ImagePickerOptions): Promise<ImagePickerResult>` | Video picker — forces `mediaType: 'video'`.                                                    |
| `requestPermission(): Promise<PermissionResponse>`              | Shows the OS permission dialog if needed.                                                          |
| `getPermissionStatus(): Promise<PermissionResponse>`            | Read-only check — no prompt.                                                                       |
| `isAvailable(): boolean`                                        | Whether the native module is registered in the current build.                                      |
```ts
interface ImagePickerOptions {
    mediaType?: 'photo' | 'video' | 'mixed';
    multiple?: boolean;
    maxItems?: number;
    quality?: number;             // 0..1
}
interface ImagePickerResult {
    cancelled: boolean;
    assets: ImagePickerAsset[];
}
interface ImagePickerAsset {
    uri: string;
    width: number;
    height: number;
    type: 'image' | 'video';
    fileSize?: number;
    fileName?: string;
}
```
## Web

On web the picker is the browser file dialog (`<input type=file>` on the host page via `@sigx/lynx-web-host`). Assets come back as `blob:` URLs — renderable by `<image>` and fetchable for uploads — with decoded `width`/`height` for images. `quality`/`maxItems` are ignored (no transcoding; the dialog has no count limit). Permission methods resolve `granted` — the dialog grants per pick, like the native pickers.

## Gotchas
- **Cancel resolves; failure throws.** The user dismissing the picker resolves `{ cancelled: true, assets: [] }` — that is an answer, not an error. So does a pick **superseded** by a second `pickImage` while the first is open, and one cut short by Activity teardown: Android tags both with an `error` string (`cancelled by new pickImage`, `activity destroyed`) where iOS just resolves, and the JS side collapses them so the two platforms agree. A native failure — the Android Activity Result launcher isn't registered, `launcher.launch` throws, iOS has no view controller to present from — rejects with a `SigxError` carrying `code: 'native_error'`. Those used to arrive as `{ cancelled: true }`, indistinguishable from a dismiss, so the app silently did nothing. Branch on `cancelled` for the dismiss; use `try`/`catch` for the failure.
- **Android system picker bypasses permissions.** Android 13+'s photo picker doesn't require runtime permission for the *selected* assets, so `requestPermission()` may be a no-op. Calling it is still safe — it just returns `granted` immediately on those API levels.
- **iOS limited library access.** On iOS 14+ users can grant access to specific photos rather than the whole library. `getPermissionStatus()` returns `'granted'` in both cases — your code generally doesn't need to differentiate.
- **Asset URIs always carry a scheme.** iOS returns `file://`-prefixed paths (writes the JPEG to `NSTemporaryDirectory()` and exposes the file URL); Android returns `content://` URIs from the system picker. Lynx's `<image src=…>` loader handles both. If you persist asset URIs (e.g. into storage) and later read them back into `<image src>`, no transformation is required.

## License

MIT
