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

- **Text-only write/read.** Binary blobs (images, PDFs) need a different shape — use `Camera`/`ImagePicker` URIs directly or roll a base64 wrapper on top.
- **Path conventions.** Always prefix paths with `getDocumentDirectory()` or `getCacheDirectory()`. Raw `/data.json` won't resolve consistently across platforms.

## Reference app

`examples/lynx-one/my-sigx-app/src/cards/FileSystemCard.tsx` covers a write → info → read → delete round-trip.
