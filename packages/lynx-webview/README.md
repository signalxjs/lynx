# @sigx/lynx-webview

Native WebView component for sigx-lynx. `WKWebView` on iOS, `android.webkit.WebView` on Android.

Use for: OAuth fallback flows, embedded help / TOS / changelog pages, hybrid screens during an incremental migration to native.

> **Not Lynx's `<webview>`.** ByteDance's Lynx team has confirmed they ship a `<webview>` element internally, but it isn't open-sourced ([lynx-family/lynx#627](https://github.com/lynx-family/lynx/issues/627)). This package registers a sigx-flavored `<sigx-webview>` so apps can ship today.

## 📚 Documentation

Full prop reference, imperative methods, page↔app messaging, security notes and live examples → **[sigx.dev/lynx/modules/webview/overview](https://sigx.dev/lynx/modules/webview/overview/)**

## Install

```bash
pnpm add @sigx/lynx-webview
```

`sigx prebuild` auto-discovers the package and registers the `<sigx-webview>` UI on both platforms. No app-side wiring required.

## A taste

```tsx
import { WebView } from '@sigx/lynx-webview';

<WebView
    src="https://example.com"
    onLoad={(e) => console.log('loaded', e.detail.url)}
    onError={(e) => console.warn('failed', e.detail.message)}
    onMessage={(e) => console.log('page said', e.detail.data)}
/>

// Inline HTML works too — no network:
<WebView html="<h1>Hello from sigx-lynx</h1>" />
```

The native side injects `window.sigx.postMessage(payload)` for page→app messaging, and exposes imperative methods (`goBack`, `reload`, `injectJavaScript`, …) via a `MainThreadRef` or Lynx's `SelectorQuery`. Security defaults (http(s)-only `src`, sandboxed inline HTML, per-instance cookie stores), the full prop table and platform gotchas are documented on the docs site.

## License

MIT
