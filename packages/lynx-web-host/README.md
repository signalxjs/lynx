# @sigx/lynx-web-host

Host-page bridge for SignalX apps running on **web** via upstream
[`@lynx-js/web-core`](https://www.npmjs.com/package/@lynx-js/web-core).

On web, a SignalX app's background code runs in a Web Worker where
page-only browser APIs (`navigator.clipboard`, `window.open`, `matchMedia`,
`<input type=file>`, vibration) don't exist. This package is the **page side**
of that gap: it handles the worker's `sigx.*` RPC calls and publishes
page-level state into the card.

`sigx run:web` wires it automatically — you only need this package directly
when hosting a SignalX web bundle in your own page.

## Usage

```html
<lynx-view url="/app/main.web.bundle"></lynx-view>
<script type="module">
  import { installSigxWebHost } from '@sigx/lynx-web-host';
  installSigxWebHost(document.querySelector('lynx-view'));
</script>
```

`dist/host.js` (exported as `@sigx/lynx-web-host/host`) is a self-contained
ESM file with zero imports, so it can also be served/loaded directly without
a bundler — that's what `sigx run:web` does (`/host/sigx-host.js`).

Call it **before the card loads** where possible; web-core caches early
`bridge.call`s until the handler is assigned, but `globalProps` should be
seeded up front. Returns an uninstall function (removes the page listeners).

## What it provides

| Surface | Backing |
|---|---|
| `sigx.clipboard.*` | `navigator.clipboard` (read denial → empty result) |
| `sigx.linking.openURL` / `canOpenURL` | `window.open` + browser-openable scheme allowlist (`http`, `https`, `mailto`, `tel`, `sms`) |
| `sigx.share.*` | `navigator.share` (capability-probed) |
| `sigx.picker.pick` | hidden `<input type=file>` → blob URLs + metadata (+ image dimensions); cancel → `[]` |
| `sigx.haptics.vibrate` | `navigator.vibrate` best-effort, never throws |
| `sigx.location.*` | `navigator.geolocation` + Permissions API (denial maps to `blocked`; `requestPermission` prompts via a position request) |
| Appearance publisher | `globalProps.appearance = {colorScheme}` from `prefers-color-scheme`, live `appearanceChanged` events — `@sigx/lynx-appearance` works unchanged, no web shim needed |
| Inbound-link publisher | `globalProps.initialURL` + `urlReceived` on popstate/hashchange — consumed by `@sigx/lynx-linking` unchanged |

The worker side calls these through `webHostCall()` from `@sigx/lynx-core`
(used by the per-package `.web.ts` shims). Protocol:
`sigx.<module>.<method>`, JSON-cloneable payloads, responses
`{ok: true, value} | {ok: false, error}`.

Publishers can be skipped via options:
`installSigxWebHost(view, { appearance: false, linking: false })`.

## Upstream coupling

Relies on web-core's `NativeModules.bridge` worker module and the
`<lynx-view>` `onNativeModulesCall` / `globalProps` / `updateGlobalProps` /
`sendGlobalEvent` surface (an existing handler is preserved — non-`sigx.*`
calls fall through to it). Tested against the `@lynx-js/web-core` version
range pinned by `@sigx/lynx-cli`.

## License

MIT
