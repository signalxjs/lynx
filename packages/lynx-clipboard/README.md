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
await Clipboard.setString('Hello, world!');
const text = await Clipboard.getString();
const isPopulated = await Clipboard.hasString();
```
## API
| Method                                | Notes                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `setString(text: string): Promise<void>` | Write text. **Rejects** if the write fails — `await` it. Pass `''` to clear.                      |
| `getString(): Promise<string>`        | Async — both platforms can prompt the user (iOS 14+ shows a "Pasted from …" toast).                |
| `hasString(): Promise<boolean>`       | Whether the clipboard currently contains a string.                                                 |
| `isAvailable(): boolean`              | Whether the native module is registered in the current build. Always synchronous.                  |

**If the native module isn't linked, every method throws** with a descriptive error naming the missing module and how to link it. Feature-detect with `isAvailable()` rather than wrapping calls in `try`/`catch`:

```ts
if (Clipboard.isAvailable()) {
    await Clipboard.setString('Hello, world!');
}
```

> **Upgrading:** `setString` used to be synchronous and return `void`. Existing calls still
> compile, but an unawaited rejection becomes an unhandled rejection rather than the silent
> no-op it used to be — so `await` it (or `.catch()` it) rather than leaving it bare.

## Web

On web (`sigx run:web`) the same API routes through the `@sigx/lynx-web-host` page bridge to `navigator.clipboard` (the app worker has no clipboard access). Reads may show a browser permission prompt; denial resolves to `''` / `false` rather than throwing.

## Gotchas
- **iOS 14+ toast.** Reading the clipboard surfaces a system-level "Pasted from <App>" notification. Don't poll — call `getString()` only on user intent (paste button, etc.).
- **Text only — and two of the gaps are permanent.**
  - **No URL clipboard.** iOS has a dedicated `UIPasteboard.url` slot; Android has no equivalent, so the same call would mean different things per platform. `setString(url)` works everywhere and is the answer. Won't do.
  - **No clipboard-change listener.** Android could back one with `OnPrimaryClipChangedListener`, but **iOS has no clipboard-change notification at all**, and polling would fire the "Pasted from …" toast repeatedly. An API that fires on one platform and never on the other is worse than none. Won't do.
  - **No image clipboard yet.** Both platforms support it; deferred because the payload must cross the bridge as a **URI, not base64** — a screenshot costs several MB otherwise. Tracked separately.

## License

MIT
