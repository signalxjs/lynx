# @sigx/lynx-file-system
File read/write/delete plus document and cache directory paths for sigx-lynx. Scoped to the app's sandbox — no broad storage access required.
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
## Gotchas
- **Text-only writes.** `writeFile` is UTF-8 text. Reads can be binary via `readFileBase64` / `readFileAsArrayBuffer`, but the whole file is materialized in memory (base64 is ~33% larger crossing the bridge) — fine for small/medium files, wrong for uploads or large media; keep using `Camera` / `ImagePicker` / `FilePicker` URIs directly where possible.
- **Path conventions.** Always prefix paths with `getDocumentDirectory()` or `getCacheDirectory()`. Raw `/data.json` won't resolve consistently across platforms.
