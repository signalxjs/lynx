# @sigx/lynx-http

WHATWG `fetch` for sigx-lynx — the HTTP transport the Lynx BG runtime doesn't ship. URLSession on iOS, OkHttp on Android, exposed behind the fetch API so portable web code works unchanged.

This completes the web-platform networking split:

| Package | Web analog |
| --- | --- |
| `@sigx/lynx-http` | `fetch` |
| [`@sigx/lynx-websocket`](https://sigx.dev/lynx/modules/websocket/overview/) | `WebSocket` |
| [`@sigx/lynx-network`](https://sigx.dev/lynx/modules/network/overview/) | `navigator.onLine` (status only) |

## 📚 Documentation

Full API, spec deviations, multipart uploads, streaming/SSE and live examples → **[sigx.dev/lynx/modules/http/overview](https://sigx.dev/lynx/modules/http/overview/)**

## Install

**You usually don't.** The umbrella `@sigx/lynx` depends on this package and imports it for its side effect, so every app gets a global `fetch` (plus `Headers`, `FormData`, `Response`, a UTF-8 `TextDecoder`) out of the box. Standalone installs (`pnpm add @sigx/lynx-http`) work the same way. Opt out with `excludeModules: ['@sigx/lynx-http']` in `signalx.config.ts`.

> ⚠️ **Don't call a *bare* `fetch(...)` on-device.** The Lynx BG runtime wraps the bundle in a factory whose `fetch` parameter shadows `globalThis.fetch`. Import it explicitly — **`import { fetch } from '@sigx/lynx'`** (recommended) or read **`globalThis.fetch(...)`** directly — so it resolves to the sigx implementation. (signalxjs/lynx#373, #378.)

## A taste

```ts
import { fetch } from '@sigx/lynx'; // required on-device (see warning above)

const res = await fetch('https://api.example.com/items', {
    headers: { Authorization: `Bearer ${token}` },
});
const items = await res.json();
```

Multipart uploads stream file bytes natively (without crossing the JS bridge), and streaming responses (`res.body.getReader()`) deliver SSE chunks incrementally. The full API, the spec deviations, request logging (under the `http` namespace) and the bridge protocol are documented on the docs site.

## Web

**Unsupported on web — and unnecessary there.** The native `Http` module isn't registered in a `sigx run:web` build (no `.web.ts` shim, no `sigx.http.*` handler in `@sigx/lynx-web-host`), so `isHttpAvailable()` is `false` and this package's `fetch()` rejects with the "module not available" error. The browser already gives the app worker a WHATWG `fetch` / `Headers` / `FormData` / `Response`, which is why `@sigx/lynx-plugin` installs the bare-`fetch` `ProvidePlugin` alias on the Lynx bundle only.

There is a sharp edge, though. This package's import-time global install keys on the presence of `NativeModules` — which `@lynx-js/web-core`'s worker also injects — so it fires on web too: importing `@sigx/lynx` (whose entry imports this package for the side effect) replaces `globalThis.fetch` / `Headers` / `FormData` / `Response` with the native-backed ones on a web build, and a bare `fetch(...)` resolves to those, **including inside a `.web.ts` sibling or a `__WEB__` branch** (the `ProvidePlugin` alias is Lynx-only, so a bare `fetch` there is just the global). Nothing in the repo swaps them back, so web code that must do HTTP has to hold a reference to the browser's implementation obtained before `@sigx/lynx` is first imported.

## License

MIT
