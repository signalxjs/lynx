# @sigx/lynx-linking

Deep links and URL scheme handling for sigx-lynx. `UIApplication.open(_:)` + AppDelegate URL hooks on iOS, `Intent.ACTION_VIEW` + `onNewIntent` on Android.

## Install

```bash
pnpm add @sigx/lynx-linking
```

```ts
// sigx.lynx.config.ts
export default defineLynxConfig({
    modules: ['@sigx/lynx-linking'],
    scheme: 'myapp', // declares myapp:// for both iOS Info.plist + Android AndroidManifest
});
```

After adding the module, run `sigx-lynx prebuild`. The CLI:

- Adds `myapp` to `CFBundleURLSchemes` in iOS `Info.plist`.
- Adds an `<intent-filter>` for `myapp://` to the Android Activity.
- Wires the `AppDelegate` (`application(_:open:options:)`, `application(_:continue:)`) and `MainActivity.onNewIntent` to forward URLs into `LinkingState` (the package's static façade).

The host wiring is reflective — apps that later remove `@sigx/lynx-linking` keep compiling. Internally the package is split into three native classes: a `LinkingModule` (registered LynxModule for outbound `openURL`/`canOpenURL`), a `LinkingState` static façade the host calls into, and a per-LynxView `LinkingPublisher` (lifecycle publisher) that forwards URLs to JS via `lynx.__globalProps.initialURL` + `sendGlobalEvent("urlReceived", ...)` — same dual-channel pattern as `@sigx/lynx-safe-area`.

> **Existing apps:** the iOS `App.swift` and Android `AndroidManifest.xml` are refreshed on every prebuild, so the iOS hooks and Android `launchMode="singleTop"` land automatically. **`MainActivity.kt` is not refreshed**, so apps scaffolded before this package was published need to manually add the snippet shown in [Manual Android wiring](#manual-android-wiring) below.

## Usage

```ts
import { Linking } from '@sigx/lynx-linking';

// Open something in the system handler (browser, mail client, dialer).
await Linking.openURL('https://lynxjs.org');

// Cold-start deep link — synchronous read from `lynx.__globalProps`.
const initial = Linking.getInitialURL();
if (initial) handle(initial);

// Warm deep links delivered while the app is running.
const sub = Linking.addEventListener('url', ({ url }) => handle(url));
// later: sub.remove();

// Probe before opening — false on iOS for non-http schemes that aren't
// listed in LSApplicationQueriesSchemes.
const ok = await Linking.canOpenURL('mailto:test@example.com');
```

### With `@sigx/router`

The package ships a thin composable that does the cold-start + warm-listener dance and forwards to the router:

```tsx
import { useLinkingRouter } from '@sigx/lynx-linking/router';

const App = component(() => {
    useLinkingRouter({
        // strip these so myapp://profile/42 pushes /profile/42
        prefixes: ['myapp://', 'https://your.domain'],
    });
    return () => <RouterView />;
});
```

For custom routing logic, pass your own handler:

```ts
useLinkingRouter({ onURL: (url) => myAuthCallback(url) });
```

### Parsing helpers

```ts
import { parse, createURL } from '@sigx/lynx-linking';

parse('myapp://host/path?token=abc#frag');
// { scheme: 'myapp', hostname: 'host', path: '/path', queryParams: { token: 'abc' } }

createURL('/profile/42', { ref: 'share' });
// '/profile/42?ref=share'
```

`parse` and `createURL` are pure JS — safe to use in tests, SSR, and the main thread without a native bridge.

## API

| Method                                                         | Notes                                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `openURL(url: string): Promise<void>`                          | Opens the URL with the system handler. Rejects on invalid URL.                                                 |
| `canOpenURL(url: string): Promise<boolean>`                    | iOS: gated by `LSApplicationQueriesSchemes` for non-http schemes. Android: resolves against the package manager. |
| `getInitialURL(): string \| null`                              | URL the app was launched with. Read synchronously from `lynx.__globalProps.initialURL` (no bridge round-trip). Mirrors the latest URL the publisher has received. |
| `addEventListener('url', listener): { remove(): void }`        | Subscribe to URL events delivered while the app is running. Returns a subscription object.                     |
| `isAvailable(): boolean`                                       | Whether the native module is registered in the current build.                                                  |

## Gotchas

- **iOS `canOpenURL`** silently returns `false` for non-`http(s)` schemes unless that scheme is whitelisted in your app's `LSApplicationQueriesSchemes` (Info.plist). To probe `mailto:` or third-party app schemes, add them there.
- **Android `launchMode`** must be `singleTop` (or `singleTask`) for warm deep links to reach the existing Activity via `onNewIntent` rather than spawning a fresh stack. The CLI templates set this; if you have a custom manifest, ensure it stays.
- **Universal Links / App Links** require host configuration outside this package: an Associated Domains entitlement + `apple-app-site-association` file on iOS; an `<intent-filter android:autoVerify="true">` + `assetlinks.json` on Android. Once configured, incoming https URLs flow through the same `addEventListener('url', …)` path.

## Manual Android wiring

For projects that pre-date `@sigx/lynx-linking`, add this to your `MainActivity.kt`:

```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    // ... existing onCreate body ...
    forwardIntentToLinking(intent)
}

override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    forwardIntentToLinking(intent)
}

private fun forwardIntentToLinking(intent: Intent?) {
    if (intent?.data == null) return
    try {
        val cls = Class.forName("com.sigx.linking.LinkingState")
        cls.getMethod("handleNewIntent", Intent::class.java).invoke(null, intent)
    } catch (_: ClassNotFoundException) {}
}
```

And in `AndroidManifest.xml` on the `<activity>` element: `android:launchMode="singleTop"`.
