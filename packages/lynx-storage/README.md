# @sigx/lynx-storage
Persistent key-value storage for sigx-lynx. `UserDefaults` on iOS, `SharedPreferences` on Android. Same shape as `localStorage` / `AsyncStorage` (string keys, string values).

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/storage/overview/](https://sigx.dev/lynx/modules/storage/overview/)**

## Install
```bash
pnpm add @sigx/lynx-storage
```
`sigx prebuild` auto-discovers the package via its `signalx-module.json` and links the native module. No special permissions on either platform.
## Usage
```ts
import { Storage } from '@sigx/lynx-storage';
Storage.setItem('user', JSON.stringify({ name: 'Alice', id: 42 }));
const raw = await Storage.getItem('user');
const user = raw ? JSON.parse(raw) : null;
Storage.removeItem('user');
const keys = await Storage.getAllKeys();
Storage.clear();   // wipes everything in this app's namespace
```
## API
| Method                                       | Notes                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `setItem(key: string, value: string): void`  | Sync — fire-and-forget write.                                                                      |
| `getItem(key: string): Promise<string \| null>` | Async. Returns `null` if the key isn't set.                                                     |
| `removeItem(key: string): void`              | Sync — no error if the key doesn't exist.                                                          |
| `clear(): void`                              | Wipes the entire app namespace.                                                                    |
| `getAllKeys(): Promise<string[]>`            | Returns all currently-set keys.                                                                    |
| `isAvailable(): boolean`                     | Whether the native module is registered in the current build.                                      |
## Web

On web (`sigx run:web`, via `@lynx-js/web-core`) the same API is backed by **IndexedDB** — the app's background code runs in a Web Worker, where `localStorage` doesn't exist. A write-through in-memory mirror keeps the sync-void `setItem`/`removeItem`/`clear` shape read-after-write consistent; the IndexedDB writes flush in call order shortly after. Data persists per origin under the `@sigx/lynx-storage` database.

## Gotchas
- **String values only.** Serialize objects with `JSON.stringify` / `JSON.parse` yourself. Don't dump raw binary — use `@sigx/lynx-file-system` for that.
- **Sync writes can race with reads** if you `setItem` then immediately `getItem` the same key from BG. UserDefaults / SharedPreferences both use a write-behind buffer; values are returned correctly within the same process, just be aware of cross-process scenarios (extension apps on iOS, etc.) where eventual consistency applies.
- **Persistence semantics.** Both stores survive app updates, are excluded from app-data exports on Android, and follow iCloud-backup rules on iOS (UserDefaults is included by default).
