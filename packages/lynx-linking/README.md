# @sigx/lynx-linking

Deep links and URL scheme handling for sigx-lynx. `UIApplication.open(_:)` + AppDelegate URL hooks on iOS, `Intent.ACTION_VIEW` + `onNewIntent` on Android.

## 📚 Documentation

Full API, router integration, parsing helpers, Universal/App Links and live examples → **[sigx.dev/lynx/modules/linking/overview](https://sigx.dev/lynx/modules/linking/overview/)**

## Install

```bash
pnpm add @sigx/lynx-linking
```

Declare your URL scheme in `signalx.config.ts`, then run `sigx prebuild`:

```ts
export default defineLynxConfig({
    scheme: 'myapp', // declares myapp:// for both iOS Info.plist + Android AndroidManifest
});
```

The CLI auto-discovers the package and wires the iOS `Info.plist` URL scheme, the Android `<intent-filter>`, and the host AppDelegate / `onNewIntent` hooks. Apps scaffolded before this package existed need a small manual `MainActivity.kt` snippet — see the docs.

## A taste

```ts
import { Linking } from '@sigx/lynx-linking';

// Open something in the system handler (browser, mail client, dialer).
await Linking.openURL('https://lynxjs.org');

// Cold-start deep link — synchronous read from globalProps.
const initial = Linking.getInitialURL();
if (initial) handle(initial);

// Warm deep links delivered while the app is running.
const sub = Linking.addEventListener('url', ({ url }) => handle(url));
```

A `useLinkingRouter` composable wires the cold-start + warm-listener dance into [`@sigx/router`](https://sigx.dev/router/), and `parse` / `createURL` are pure-JS helpers. The full API, platform gotchas, and Universal/App Links setup are documented on the docs site.

## License

MIT
