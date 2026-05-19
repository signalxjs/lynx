# @sigx/lynx-websocket

Browser-standard `WebSocket` client for sigx-lynx. Wraps
`URLSessionWebSocketTask` on iOS and OkHttp `WebSocket` on Android, and
installs a global `WebSocket` class that matches the WHATWG / MDN API so
portable web code works unchanged.

> Note: this is **only for WebSockets**. Plain HTTP works out of the box —
> Lynx already ships a global `fetch()`. See [Networking](#networking)
> below.

## Install

```bash
pnpm add @sigx/lynx-websocket
```

Then run `sigx prebuild` — the CLI auto-discovers the package
via its `signalx-module.json` and regenerates the iOS / Android projects.
No permissions are required on either platform (OkHttp piggy-backs on
the app's standard `INTERNET` permission, which the host app already
declares).

## Usage

Listing the package in `modules:` registers a global `WebSocket` — you don't
need to `import` anything to use it:

```ts
const ws = new WebSocket('wss://ws.postman-echo.com/raw');

ws.onopen = () => ws.send('hello');
ws.onmessage = (event) => {
    console.log('received', event.data);
};
ws.onclose = (event) => {
    console.log('closed', event.code, event.reason);
};
```

If you prefer an explicit import (e.g. for TypeScript clarity, or to use
inside a library that shouldn't assume the global is set):

```ts
import { WebSocket } from '@sigx/lynx-websocket';

const ws = new WebSocket('wss://example.com/socket');
```

### Binary frames

`binaryType` is fixed to `'arraybuffer'` — `'blob'` is not supported (Lynx
doesn't ship a `Blob` polyfill, matching upstream's `fetch` constraints).
Send `ArrayBuffer` / typed arrays directly:

```ts
const ws = new WebSocket('wss://example.com/socket');
ws.binaryType = 'arraybuffer';

ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        // ...
    }
};

ws.onopen = () => {
    ws.send(new Uint8Array([0x01, 0x02, 0x03]));
};
```

### Subprotocols

Pass a string or array of strings as the second arg to the constructor —
the negotiated value is available on `ws.protocol` after `open`:

```ts
const ws = new WebSocket('wss://example.com/chat', ['v2.chat', 'v1.chat']);
ws.onopen = () => console.log('negotiated', ws.protocol);
```

## API

Matches [`WebSocket` on MDN](https://developer.mozilla.org/docs/Web/API/WebSocket):

| Member | Type | Notes |
|---|---|---|
| `new WebSocket(url, protocols?)` | constructor | `url` must be `ws:` / `wss:` (http/https accepted, normalised by native). |
| `readyState` | `0 \| 1 \| 2 \| 3` | `CONNECTING / OPEN / CLOSING / CLOSED`. |
| `url` | `string` | The URL passed to the constructor. |
| `protocol` | `string` | Negotiated subprotocol; `''` until `open`. |
| `extensions` | `string` | Negotiated `Sec-WebSocket-Extensions`. |
| `bufferedAmount` | `number` | Bytes handed to native, not yet acked. Approximate; updated on `send`. |
| `binaryType` | `'arraybuffer'` | Fixed — `'blob'` is unsupported. |
| `send(data)` | method | `string \| ArrayBuffer \| ArrayBufferView`. Throws if `CONNECTING`. |
| `close(code?, reason?)` | method | Browser semantics: `1000` or `3000–4999`; reason ≤123 UTF-8 bytes. |
| `onopen / onmessage / onerror / onclose` | listener slot | Standard WHATWG event shape. |
| `addEventListener(type, fn)` / `removeEventListener` / `dispatchEvent` | EventTarget | Multiple listeners per event. |
| Class constants | `CONNECTING (0) / OPEN (1) / CLOSING (2) / CLOSED (3)` | On both class and instance. |
| `isWebSocketAvailable()` | export | Whether the native module is registered (useful in tests / SSR). |

## Caveats vs the browser

- **No `Blob`** binary type — use `ArrayBuffer`.
- **`bufferedAmount`** is a JS-side approximation (bytes handed off to
  native), not the OS socket buffer level. Sufficient for backpressure
  hinting; don't use it for exact accounting.
- **`Sec-WebSocket-Extensions`** negotiation is whatever URLSession (iOS)
  or OkHttp (Android) offers — neither advertises `permessage-deflate` by
  default. If you need it, configure the server to live without it or open
  an issue.
- **No `Sec-WebSocket-Key` access** — handshake headers other than
  `Sec-WebSocket-Protocol` aren't customizable from JS in this version.

## How it works

JS → native is a 3-method bridge (`create / send / close`). Native → JS is
a single `__sigxWebSocketEvent` global event multiplexed by a monotonic
numeric id; the shim demultiplexes per-instance. A per-`LynxView`
publisher pumps events from a process-wide `WebSocketEventBus` into
`LynxView.sendGlobalEvent`. Sockets outlive any single LynxView so a
template reload doesn't drop in-flight connections that JS is
re-attaching to.

## Related

- **HTTP**: just call `fetch()` — it's a built-in Lynx global. No package
  needed. See [upstream Lynx fetch docs](https://lynxjs.org/api/lynx-api/global/fetch.html)
  for the Lynx subset (no CORS / redirect / keepalive / FormData / Blob).
- **Connectivity**: [`@sigx/lynx-network`](../lynx-network) for online /
  offline and connection-type state.

## Reference app

Once wired in, point it at an echo service to smoke-test:

```ts
const ws = new WebSocket('wss://ws.postman-echo.com/raw');
ws.onopen = () => ws.send('ping');
ws.onmessage = (e) => console.log(e.data); // → 'ping'
```
