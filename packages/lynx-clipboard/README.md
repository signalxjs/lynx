# @sigx/lynx-clipboard
System clipboard access for sigx-lynx. `UIPasteboard` on iOS, `ClipboardManager` on Android.
## Install
```bash
pnpm add @sigx/lynx-clipboard
```
No special permissions — `sigx prebuild` auto-discovers and links the native module.
## Usage
```ts
import { Clipboard } from '@sigx/lynx-clipboard';
Clipboard.setString('Hello, world!');
const text = await Clipboard.getString();
const isPopulated = await Clipboard.hasString();
```
## API
| Method                                | Notes                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `setString(text: string): void`       | Sync write.                                                                                        |
| `getString(): Promise<string>`        | Async — both platforms can prompt the user (iOS 14+ shows a "Pasted from …" toast).                |
| `hasString(): Promise<boolean>`       | Whether the clipboard currently contains a string.                                                 |
| `isAvailable(): boolean`              | Whether the native module is registered in the current build.                                      |
## Gotchas
- **iOS 14+ toast.** Reading the clipboard surfaces a system-level "Pasted from <App>" notification. Don't poll — call `getString()` only on user intent (paste button, etc.).
