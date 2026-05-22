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

## Gotchas

- **`src` is restricted to `http(s):` and `about:blank`**. `javascript:` URLs are refused (logged + ignored) — they're the headline XSS vector for embedded WebViews. `file:` is refused too; Android also disables `allowFileAccess`/`allowContentAccess` + the legacy file-URL universal-access flags by default. Apps that need richer content should use the `html` prop (rendered with a null base URL → fully sandboxed).
- **Imperative methods not implemented in v1**: `goBack` / `goForward` / `reload` / `postMessage` from JS to the page / `injectJavaScript`. Tracked as a v2 follow-up — they need Lynx's `UIMethodInvoker` surface, which isn't wired through sigx-lynx yet.
- **iOS App Transport Security**: HTTPS-only by default in release builds. To load HTTP URLs you'd need to relax ATS in `Info.plist` (and accept the App Store review risk). Dev builds already allow LAN HTTP via the existing `NSAllowsLocalNetworking` flag.
- **Android `mixed-content`**: defaults block HTTP subresources on HTTPS pages. If you load a mixed-content page, set `webView.settings.mixedContentMode` manually — not currently exposed as a prop.
- **Cookies**: the WebView uses its own `WKWebsiteDataStore` (iOS) / `CookieManager` (Android). Cookies are **not** shared with the system Safari / Chrome.
- **No file uploads / downloads in v1**: file `<input type="file">` and `Content-Disposition: attachment` aren't wired through.
- **`debug` on Android is process-wide**: enabling it on any `<WebView>` instance also flips the flag for every other WebView in the app. Toggling off after enable doesn't detach already-attached `chrome://inspect` sessions.

## Reference app

`examples/showcase/src/screens/Settings.tsx` has a "Native WebView" card that exercises URL load, inline HTML, and `postMessage` round-trip.
