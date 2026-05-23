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

Capture a `MainThreadRef` to the WebView via the `mtRef` prop and drive it from a main-thread event handler. `WebViewMethods` is a typed wrapper around `MainThread.Element.invoke(method, params)` — saves you from typing the magic method-name strings.

```tsx
import { useMainThreadRef, type MainThread } from '@sigx/lynx';
import { WebView, WebViewMethods } from '@sigx/lynx-webview';

const ref = useMainThreadRef<MainThread.Element | null>(null);

const onBack = () => {
    'main thread';
    WebViewMethods.goBack(ref.current);
};
const onEval = () => {
    'main thread';
    WebViewMethods
        .injectJavaScript(ref.current, 'document.title')
        .then((title) => console.log('title is', title));
};
const onTalkToPage = () => {
    'main thread';
    WebViewMethods.postMessage(ref.current, 'hello from host');
};

<WebView mtRef={ref} src="https://example.com" />
```

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

`examples/showcase/src/screens/TripGuide.tsx` is a real-app integration: each trip's destination ("Lisbon, May 2026" → `Lisbon`) drives a Wikivoyage URL loaded in a WebView, with an `onLoad` loading overlay, an `onError` retry surface, and a bottom toolbar wiring Back / Forward / Reload via `WebViewMethods` so the user can navigate Wikivoyage internal links without leaving the screen. Reachable from `TripDetail` via the `Guide` header button.
