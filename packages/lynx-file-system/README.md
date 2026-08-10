# @sigx/lynx-file-system
File read/write/delete plus document and cache directory paths for sigx-lynx. Scoped to the app's sandbox — no broad storage access required.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/file-system/overview/](https://sigx.dev/lynx/modules/file-system/overview/)**

## Install
```bash
pnpm add @sigx/lynx-file-system
```
`sigx prebuild` auto-discovers and links the native module. No special permissions — both platforms expose per-app document/cache directories without runtime grants.
## Usage
```ts
import { FileSystem } from '@sigx/lynx-file-system';
const docs = FileSystem.getDocumentDirectory();
await FileSystem.writeFile(`${docs}/data.json`, JSON.stringify({ key: 'value' }));
const content = await FileSystem.readFile(`${docs}/data.json`);
const info = await FileSystem.getInfo(`${docs}/data.json`);
if (info.exists) {
    await FileSystem.deleteFile(`${docs}/data.json`);
}
```
## API
| Method                                                  | Notes                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `getDocumentDirectory(): string`                        | Sync. Persistent app data — survives app updates, included in iCloud/Android backup.               |
| `getCacheDirectory(): string`                           | Sync. Disposable storage — OS may purge under disk pressure.                                       |
| `writeFile(path: string, content: string): Promise<void>` | UTF-8 text. Creates parent directories as needed.                                                |
| `readFile(path: string): Promise<string>`               | UTF-8 text. Throws if the file doesn't exist.                                                      |
| `readFileBase64(path: string): Promise<string>`         | Raw bytes, base64-encoded. Also accepts `file://` and (Android) `content://` URIs — anything a picker hands back. |
| `readFileAsArrayBuffer(path: string): Promise<ArrayBuffer>` | `readFileBase64` decoded to an `ArrayBuffer`.                                                  |
| `deleteFile(path: string): Promise<void>`               | No-op if the file doesn't exist.                                                                   |
| `getInfo(path: string): Promise<FileInfo>`              | Always returns a `FileInfo` — check `exists` for presence.                                         |
| `isAvailable(): boolean`                                | Whether the native module is registered in the current build.                                      |
```ts
interface FileInfo {
    uri: string;
    size: number;
    exists: boolean;
    isDirectory: boolean;
    modifiedAt: number;     // epoch milliseconds
}
```
## Web
**Not supported on web** (`sigx run:web`). There is no `sigx.filesystem.*` handler in the `@sigx/lynx-web-host` page bridge and no `.web.ts` implementation, so the module isn't registered: `isAvailable()` returns `false`, the sync directory getters throw, and every read/write rejects — all with core's `Module "FileSystem" is not available` error. A browser has no app sandbox with document/cache directories to hand out — the closest equivalent, the Origin Private File System (`navigator.storage.getDirectory()`), is what a future shim would be built on.

On web, reach for the capability you actually need instead:
- **Persisted app data** — [`@sigx/lynx-storage`](https://sigx.dev/lynx/modules/storage/overview/), whose web implementation is IndexedDB-backed and works unchanged.
- **User-chosen files** — [`@sigx/lynx-file-picker`](https://sigx.dev/lynx/modules/file-picker/overview/) / [`@sigx/lynx-image-picker`](https://sigx.dev/lynx/modules/image-picker/overview/), which hand back `blob:` URLs you can `fetch()` rather than paths you read.
## Gotchas
- **Text-only writes.** `writeFile` is UTF-8 text. Reads can be binary via `readFileBase64` / `readFileAsArrayBuffer`, but the whole file is materialized in memory (base64 is ~33% larger crossing the bridge) — fine for small/medium files, wrong for uploads or large media; keep using `Camera` / `ImagePicker` / `FilePicker` URIs directly where possible.
- **Path conventions.** Always prefix paths with `getDocumentDirectory()` or `getCacheDirectory()`. Raw `/data.json` won't resolve consistently across platforms.

## License

MIT
