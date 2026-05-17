# @sigx/lynx-image-picker

Pick photos and videos from the system gallery for sigx-lynx. iOS uses `PHPickerViewController` (iOS 14+) / `UIImagePickerController` (older); Android uses the system photo picker (Android 13+) / `ACTION_OPEN_DOCUMENT` (older).

## Install

```bash
pnpm add @sigx/lynx-image-picker
```

```ts
// sigx.lynx.config.ts
export default defineLynxConfig({
    modules: ['@sigx/lynx-image-picker'],
});
```

`sigx prebuild` auto-links the native module, injects the iOS `NSPhotoLibraryUsageDescription`, and adds the Android media-read permissions:

- `READ_MEDIA_IMAGES`
- `READ_MEDIA_VIDEO`
- `READ_EXTERNAL_STORAGE` (older API levels)

> **Android pairs with `@sigx/lynx-permissions`** — needed for the Activity Result wiring.

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

## Gotchas

- **Android system picker bypasses permissions.** Android 13+'s photo picker doesn't require runtime permission for the *selected* assets, so `requestPermission()` may be a no-op. Calling it is still safe — it just returns `granted` immediately on those API levels.
- **iOS limited library access.** On iOS 14+ users can grant access to specific photos rather than the whole library. `getPermissionStatus()` returns `'granted'` in both cases — your code generally doesn't need to differentiate.
- **Asset URIs always carry a scheme.** iOS returns `file://`-prefixed paths (writes the JPEG to `NSTemporaryDirectory()` and exposes the file URL); Android returns `content://` URIs from the system picker. Lynx's `<image src=…>` loader handles both. If you persist asset URIs (e.g. into storage) and later read them back into `<image src>`, no transformation is required.

## Reference app

`examples/lynx-one/my-sigx-app/src/cards/ImagePickerCard.tsx` covers single + multi-select with the asset URIs rendered into a strip.
