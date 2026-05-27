# @sigx/lynx-webview

Native WebView component for sigx-lynx. `WKWebView` on iOS, `android.webkit.WebView` on Android.

Use for: OAuth fallback flows, embedded help / TOS / changelog pages, hybrid screens during an incremental migration to native.

> **Not Lynx's `<webview>`.** ByteDance's Lynx team has confirmed they ship a `<webview>` element internally, but it isn't open-sourced ([lynx-family/lynx#627](https://github.com/lynx-family/lynx/issues/627)). This package registers a sigx-flavored `<sigx-webview>` so apps can ship today.

## Install

```bash
pnpm add @sigx/lynx-webview
```

`sigx prebuild` auto-discovers the package and:
- iOS: emits a `GeneratedComponentRegistry.swift` call to `LynxConfig.registerUI(SigxWebViewUI.self, withName: "sigx-webview")` in `LynxSetupService.initialize`.
- Android: emits a `GeneratedBehaviors.attachAll(builder)` call alongside the existing `XElementBehaviors().create()` in `MainActivity.kt` and the dev-client path.

No app-side wiring required.

## Usage

```tsx
import { WebView } from '@sigx/lynx-webview';

<WebView
    src="https://example.com"
    onLoad={(e) => console.log('loaded', e.detail.url)}
    onError={(e) => console.warn('failed', e.detail.message)}
    onMessage={(e) => console.log('page said', e.detail.data)}
/>
```

Inline HTML works too — no network:

```tsx
<WebView html="<h1>Hello from sigx-lynx</h1>" />
```

### Page → app messaging

The native side injects `window.sigx.postMessage(payload)` at document start. Any page rendered inside the WebView can call it; the payload arrives in JS as `event.detail.data` (always a string).

```html
<button onclick="window.sigx.postMessage(JSON.stringify({ click: 'hi' }))">
  Send
</button>
```

```tsx
<WebView
    html={pageHtml}
    onMessage={(e) => {
        const data = JSON.parse(e.detail.data);
        // data.click === 'hi'
    }}
/>
```

### Imperative methods (v2)

Two valid call patterns depending on which thread your handler runs on. **There is no one-size-fits-all helper** — `MainThread.Element` only lives on the MT side, and `SelectorQuery` only works from BG.

**Pattern A — from a main-thread tap handler (recommended for toolbar buttons).** Capture a `MainThreadRef`, then call `.invoke()` directly on `ref.current` inside a `'main thread'` handler. Bind the handler to a raw `<view main-thread:bindtap=…>` element — daisyui's `<Button>` only exposes an `onPress` callback (BG-thread) and silently drops `main-thread:bindtap`, so the tap would never reach the handler.

```tsx
import { useMainThreadRef, type MainThread } from '@sigx/lynx';
import { WebView } from '@sigx/lynx-webview';

const ref = useMainThreadRef<MainThread.Element | null>(null);

const onBack = () => {
    'main thread';
    ref.current?.invoke('goBack', {});
};
const onReload = () => {
    'main thread';
    ref.current?.invoke('reload', {});
};

<WebView mtRef={ref} id="my-webview" src="https://example.com" />
<view main-thread:bindtap={onBack}><Text>‹ Back</Text></view>
<view main-thread:bindtap={onReload}><Text>↻ Reload</Text></view>
```

The `'main thread'` directive compiles the handler into a separate main-thread bundle that can't reach cross-package imports — so you must call `.invoke()` directly, not via a JS wrapper from another package.

**Pattern B — from a BG-thread handler (e.g. daisyui `<Button onPress>`).** Use Lynx's `SelectorQuery` to dispatch by element id. Give the WebView an `id` and select by it.

```tsx
import { Button } from '@sigx/lynx-daisyui';

<WebView id="my-webview" src="https://example.com" />
<Button onPress={() => {
    lynx.createSelectorQuery().select('#my-webview').invoke({
        method: 'reload',
        params: {},
        success: () => {},
        fail: (e) => console.warn(e),
    }).exec();
}}>
    Reload
</Button>
```

A typed wrapper that bundles this is exported as `WebViewMethods` for apps that prefer not to write the `SelectorQuery` boilerplate by hand — but note it only works when the relevant `MainThread.Element` is reachable (i.e. inside a `runOnMainThread` block, not from a bare `onPress`).

| Method | Signature | Notes |
|---|---|---|
| `goBack` | `(el)` → `void` | No-op when no back history. |
| `goForward` | `(el)` → `void` | No-op when no forward history. |
| `reload` | `(el)` → `void` | |
| `stopLoading` | `(el)` → `void` | |
| `canGoBack` | `(el)` → `Promise<boolean>` | Resolves `false` when `el` is null. |
| `canGoForward` | `(el)` → `Promise<boolean>` | Same. |
| `injectJavaScript` | `(el, code)` → `Promise<string>` | Last-expression value, stringified. Non-string results (numbers, dicts) coerce via `String(result)`. `null` / `undefined` → `""`. |
| `postMessage` | `(el, data)` → `void` | Delivers to `window.sigx.onmessage(data)` inside the page. Pages that haven't subscribed get a silent no-op. |

Host → page subscription happens in the page itself:

```html
<script>
  window.sigx.onmessage = function(data) {
    console.log('from host', data);
  };
</script>
```

All `WebViewMethods.*` accept `el | null` and no-op when null, so you can pass `ref.current` straight through without an `if` guard.

The same methods are also reachable via Lynx's `SelectorQuery` API for apps that prefer ID-based dispatch:

```ts
lynx.createSelectorQuery().select('#my-webview').invoke({
    method: 'reload',
    params: {},
    success: () => {},
    fail: (e) => console.warn(e),
}).exec();
```

## Props

| Prop | Type | Notes |
|---|---|---|
| `src` | `string` | URL to load. Mutually exclusive with `html`. |
| `html` | `string` | Inline HTML, no network. Base URL is `null` — relative URLs won't resolve. |
| `userAgent` | `string` | Override the WebView's User-Agent. |
| `debug` | `boolean` | iOS 16.4+: Safari Web Inspector via `WKWebView.isInspectable`. Android: `WebView.setWebContentsDebuggingEnabled(true)` — note this is **process-wide** on Android, not per-instance. |
| `class` / `style` | string / object | Standard Lynx layout. |
| `onLoad` | `(e) => void` | Main-frame navigation finished. `e.detail.url`. |
| `onError` | `(e) => void` | Main-frame load failed. `e.detail.{url, message}`. Subresource errors (favicon, image) are suppressed. |
| `onMessage` | `(e) => void` | Page called `window.sigx.postMessage(payload)`. `e.detail.data` is a string. |
| `mtRef` | `MainThreadRef<MainThread.Element \| null>` | Captures the underlying native element so you can drive the v2 imperative methods. |

## Gotchas

- **`src` is restricted to `http(s):` and `about:blank`**. `javascript:` URLs are refused (logged + ignored) — they're the headline XSS vector for embedded WebViews. `file:` is refused too; Android also disables `allowFileAccess`/`allowContentAccess` + the legacy file-URL universal-access flags by default. Apps that need richer content should use the `html` prop (rendered with a null base URL → fully sandboxed).
- **iOS App Transport Security**: HTTPS-only by default in release builds. To load HTTP URLs you'd need to relax ATS in `Info.plist` (and accept the App Store review risk). Dev builds already allow LAN HTTP via the existing `NSAllowsLocalNetworking` flag.
- **Android `mixed-content`**: defaults block HTTP subresources on HTTPS pages. If you load a mixed-content page, set `webView.settings.mixedContentMode` manually — not currently exposed as a prop.
- **Cookies**: the WebView uses its own `WKWebsiteDataStore` (iOS) / `CookieManager` (Android). Cookies are **not** shared with the system Safari / Chrome.
- **No file uploads / downloads in v1**: file `<input type="file">` and `Content-Disposition: attachment` aren't wired through.
- **`debug` on Android is process-wide**: enabling it on any `<WebView>` instance also flips the flag for every other WebView in the app. Toggling off after enable doesn't detach already-attached `chrome://inspect` sessions.

## Reference app

[`examples/showcase/src/screens/TripGuide.tsx`](https://github.com/signalxjs/lynx/blob/main/examples/showcase/src/screens/TripGuide.tsx) is a real-app integration: each trip's destination ("Lisbon, May 2026" → `Lisbon`) drives a Wikivoyage URL loaded in a WebView, with an `onLoad` loading overlay, an `onError` retry surface, and a bottom toolbar wiring Back / Forward / Reload via `WebViewMethods` so the user can navigate Wikivoyage internal links without leaving the screen. Reachable from `TripDetail` via the `Guide` header button.
