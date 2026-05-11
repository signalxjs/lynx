# @sigx/lynx-share

Native share dialog for sigx-lynx. `UIActivityViewController` on iOS, `Intent.ACTION_SEND` chooser on Android.

## Install

```bash
pnpm add @sigx/lynx-share
```

```ts
// sigx.lynx.config.ts
export default defineLynxConfig({
    modules: ['@sigx/lynx-share'],
});
```

No special permissions on either platform.

## Usage

```ts
import { Share } from '@sigx/lynx-share';

Share.share({
    title: 'Check this out',
    message: 'Built with sigx-lynx!',
    url: 'https://sigx.dev',
});
```

## API

| Method                                | Notes                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `share(options: ShareOptions): void`  | Sync — fire-and-forget. The share sheet dismissal isn't surfaced as a callback.                    |
| `isAvailable(): boolean`              | Whether the native module is registered in the current build.                                      |

```ts
interface ShareOptions {
    title?: string;
    message?: string;
    url?: string;
}
```

## Gotchas

- **Sharing files** isn't directly supported — `url` is treated as a string (web URL). For local file sharing, the native side would need to handle file URIs and FileProvider authority, which isn't wired here yet.
- **No completion callback.** If you need to know whether the user actually shared (vs. cancelled the sheet), you'll need to extend the native module with `UIActivityViewController.completionWithItemsHandler` (iOS) / `ACTION_SEND` result handling (Android, harder — there's no clean signal).

## Reference app

`examples/lynx-one/my-sigx-app/src/cards/ShareCard.tsx` covers a simple share-sheet trigger with title + message + URL.
