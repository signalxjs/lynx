# @sigx/lynx-clipboard
System clipboard access for sigx-lynx. `UIPasteboard` on iOS, `ClipboardManager` on Android.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/clipboard/overview/](https://sigx.dev/lynx/modules/clipboard/overview/)**

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
| `isAvailable(): boolean`              | Whether the native module is registered in the current build. Always synchronous.                  |

**If the native module isn't linked, every method throws** with a descriptive error naming the missing module and how to link it. Feature-detect with `isAvailable()` rather than wrapping calls in `try`/`catch`:

```ts
if (Clipboard.isAvailable()) {
    Clipboard.setString('Hello, world!');
}
```

## Web

On web (`sigx run:web`) the same API routes through the `@sigx/lynx-web-host` page bridge to `navigator.clipboard` (the app worker has no clipboard access). Reads may show a browser permission prompt; denial resolves to `''` / `false` rather than throwing.

## Gotchas
- **iOS 14+ toast.** Reading the clipboard surfaces a system-level "Pasted from <App>" notification. Don't poll — call `getString()` only on user intent (paste button, etc.).
- **`setString` can't report failure.** It is synchronous and returns `void`, so a rejected write is invisible to the caller. Tracked in [#872](https://github.com/signalxjs/lynx/issues/872).
- **Text only.** No image or URL clipboard, and no change listener. Also tracked in [#872](https://github.com/signalxjs/lynx/issues/872) — iOS in particular has no clipboard-change notification, so a cross-platform listener may not be possible.

## License

MIT
