# @sigx/lynx-file-picker
Pick **any file** from the device for sigx-lynx. iOS uses `UIDocumentPickerViewController` (iOS 14+); Android uses the Storage Access Framework (`OpenDocument` / `OpenMultipleDocuments`).

> **Two pickers, two UIs.** This is the *generic* file picker (Files app / SAF document browser) — it can pick anything, media included. For the photo-library grid UX (PHPicker / Android Photo Picker) use `@sigx/lynx-image-picker` — the OS ships two distinct picker UIs and so do we.

## Install
```bash
pnpm add @sigx/lynx-file-picker
```
`sigx prebuild` auto-discovers the package and links the native module. No permissions and no iOS usage descriptions are needed — both platform pickers grant per-pick access on the fly.
> **Android pairs with `@sigx/lynx-permissions`** — needed for the Activity Result wiring.
## Usage
```ts
import { FilePicker } from '@sigx/lynx-file-picker';

const result = await FilePicker.pick({ types: ['application/pdf'], multiple: true });
if (!result.cancelled) {
    for (const file of result.assets) {
        console.log(file.name, file.mimeType, file.size, file.uri);
    }
}
```
Picked assets are ready-made file handles for `@sigx/lynx-http` uploads:
```ts
const form = new FormData();
form.append('file', result.assets[0]); // native streams the bytes from the URI
await fetch(url, { method: 'POST', body: form });
```
Need the bytes in JS? Pair with `@sigx/lynx-file-system`:
```ts
import { FileSystem } from '@sigx/lynx-file-system';
const bytes = await FileSystem.readFileAsArrayBuffer(result.assets[0].uri);
```
## API
| Method                                                      | Notes                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `pick(options?: FilePickerOptions): Promise<FilePickerResult>` | Opens the system document picker.                                 |
| `isAvailable(): boolean`                                    | Whether the native module is registered in the current build.        |
```ts
interface FilePickerOptions {
    multiple?: boolean;      // default false
    types?: string[];        // MIME filters, e.g. ['application/pdf', 'image/*']; omit for any file
    copyToCache?: boolean;   // default true — copy into app storage, return stable file:// URI
}
interface FilePickerResult {
    cancelled: boolean;
    assets: FilePickerAsset[];
}
interface FilePickerAsset {
    uri: string;        // file:// (copied) or content:// (Android, copyToCache: false)
    name: string;       // original file name
    mimeType: string;   // 'application/octet-stream' when unknown
    size: number;       // bytes; 0 when unknowable
}
```
## Gotchas
- **`copyToCache: false` returns an ephemeral URI on both platforms.** Android: SAF's `content://` read grant is Activity-scoped — once the app is killed, the URI is unreadable. iOS: the picker runs with `asCopy: true`, so you get a temporary `file://` copy in tmp that iOS may purge at any time. The default (`true`) copies the bytes into app storage (`filesDir/picked/` / `Documents/picked/`) and returns a stable `file://` URI that survives restarts.
- **MIME filters are best-effort on iOS.** MIME strings are mapped to UTTypes (`image/*` → `.image`, etc.); unknown MIME strings are skipped, and if nothing maps the picker falls back to "any file" rather than failing.
- **No permission methods on purpose.** Unlike the photo library there is no runtime permission to request — the document picker UI itself is the consent.
