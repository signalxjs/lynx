# @sigx/lynx-http
WHATWG `fetch` for sigx-lynx — the HTTP transport the Lynx BG runtime doesn't ship. URLSession on iOS, OkHttp on Android, exposed behind the fetch API so portable web code works unchanged.

This completes the web-platform networking split:

| Package | Web analog |
| --- | --- |
| `@sigx/lynx-http` | `fetch` |
| `@sigx/lynx-websocket` | `WebSocket` |
| `@sigx/lynx-network` | `navigator.onLine` (status only) |

## Install
**You usually don't.** The umbrella `@sigx/lynx` depends on this package and imports it for its side effect, and `sigx prebuild` discovers umbrella-carried native modules automatically — every app gets a global `fetch` out of the box. Standalone installs (`pnpm add @sigx/lynx-http`) work the same way.

Importing installs `fetch`, `Headers`, `FormData`, `Response`, and a minimal UTF-8 `TextDecoder` on `globalThis`. Precedence: when the `Http` native module is linked, the sigx stack **replaces** any engine-provided fetch — some Lynx runtimes ship a built-in fetch without `FormData`/streaming, and mixing the two breaks uploads platform-dependently. On hosts without the module (web, Node, tests) installs are `typeof`-guarded so the native fetch stack stays untouched. Opt out of the module with `excludeModules: ['@sigx/lynx-http']` in `signalx.config.ts`.

## Usage
```ts
// No import needed — fetch is global.
const res = await fetch('https://api.example.com/items', {
    headers: { Authorization: `Bearer ${token}` },
});
const items = await res.json();
```
### Multipart upload (chat attachments)
File bytes **never cross the JS bridge** — `FormData` carries a URI descriptor and the native side streams the file straight into the request body.
```ts
import { FilePicker } from '@sigx/lynx-file-picker';

const { assets } = await FilePicker.pick();
const form = new FormData();
form.append('file', assets[0]); // { uri, name, mimeType, size } — a ready-made handle
form.append('purpose', 'chat-attachment');

const res = await fetch('https://api.example.com/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    onUploadProgress: (loaded, total) => updateBar(loaded / total), // non-standard nicety
});
```
RN-convention handles (`{ uri, name, type }`) are accepted too.
### Streaming / SSE
```ts
const res = await fetch(sseUrl, { headers: { Accept: 'text/event-stream' }, signal });
const reader = res.body.getReader();
const decoder = new TextDecoder();
for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parseSseChunk(decoder.decode(value, { stream: true }));
}
```
Chunks arrive as the network delivers them — `read()` resolves per network read, so SSE tokens render incrementally. `reader.cancel()` (or aborting the signal) cancels the native task mid-stream.

## API notes & deviations from spec
- `Response`: `ok/status/statusText/headers/url/bodyUsed`, `text()/json()/arrayBuffer()`, `body.getReader()` → `{ read, cancel, releaseLock }`. No `clone()`, no `blob()` (no Blob in the runtime).
- A body with no explicit `method` defaults to `POST` (spec says GET-and-throw; this is friendlier and doesn't affect portable code, which sets the method).
- `AbortSignal` is duck-typed — any `{ aborted, addEventListener }` works; aborting rejects with an `AbortError`-named error and cancels the native task. `reader.cancel()` also aborts.
- Backpressure is not implemented: chunks queue in JS until read (same tradeoff as `@sigx/lynx-websocket`). Very large downloads buffer in JS if you never read.
- Redirects follow silently (URLSession/OkHttp defaults); `response.url` is the request URL.

## Bridge protocol (for contributors)
`Http.request(id, spec, cb)` / `Http.abort(id, cb)`; outcomes arrive as `__sigxHttpEvent` global events demuxed by id: `response` (once) → `progress`* → `chunk`* (base64) → `done` | `error`. `spec.streaming: true` (what `fetch` always sends) delivers one `chunk` per network read; `false` buffers the body into a single chunk — see `src/types.ts`.
