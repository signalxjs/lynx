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
| `sigx.notifications.*` | local notifications via the Notification API (page-lifetime timers/repeats, permission mapping, Badging-API badges) |
| Appearance publisher | `globalProps.appearance = {colorScheme}` from `prefers-color-scheme`, live `appearanceChanged` events — `@sigx/lynx-appearance` works unchanged, no web shim needed |
| Inbound-link publisher | `globalProps.initialURL` + `urlReceived` on popstate/hashchange — consumed by `@sigx/lynx-linking` unchanged |
| Text-color parity style | adopts `x-text { color: inherit }` into the `<lynx-view>` shadow root — upstream web-core defaults top-level text to `color: initial` (black), native inherits the ancestor `color`, so themed dark-mode text painted black on web only. Opt out: `installSigxWebHost(view, { textColorInheritance: false })` |
| Viewport `browser-config` | overrides web-core's `SystemInfo.pixelWidth/pixelHeight` with the `<lynx-view>`'s own box (see below). Opt out: `installSigxWebHost(view, { viewport: false })` |
| `ignore-focus` parity | a capture-phase `mousedown` on the shadow root `preventDefault`s taps on a non-focusable `[ignore-focus]` element, so a toolbar / suggestion-popup tap doesn't blur a focused editor (native honors `ignore-focus`; web-core doesn't). A focusable descendant (the editor lives inside the composer's `ignore-focus` row) is left alone so it can still focus. Opt out: `installSigxWebHost(view, { ignoreFocus: false })` |

The worker side calls these through `webHostCall()` from `@sigx/lynx-core`
(used by the per-package `.web.ts` shims). Protocol:
`sigx.<module>.<method>`, JSON-cloneable payloads, responses
`{ok: true, value} | {ok: false, error}`.

Publishers can be skipped via options:
`installSigxWebHost(view, { appearance: false, linking: false })`.

### Viewport dimensions (`viewportBrowserConfig`)

web-core derives `SystemInfo.pixelWidth`/`pixelHeight` from
`screen.availWidth`/`availHeight` — the **physical display**. Everything
downstream treats those as the screen the app occupies:
`@sigx/lynx-navigation` slides cards in from `SCREEN_WIDTH` px away and rests
sheets at a fraction of `SCREEN_HEIGHT`, `@sigx/lynx-gestures`' `Swiper` falls
back to it for page width, and `Platform.isPad` derives from it. Inside a
`<lynx-view>` smaller than the monitor, a sheet can settle below the visible
area entirely.

`browser-config` overrides those fields, and `installSigxWebHost` sets it from
the element's box when the host page hasn't. If you write your own host page,
prefer setting the attribute **inline while the document parses** — that is
strictly before the engine module upgrades `<lynx-view>` and reads the value,
whereas a module script races the element's own render kickoff:

```html
<lynx-view id="app" url="/app/main.web.bundle" style="height:100vh;width:100vw"></lynx-view>
<script>
  var v = document.getElementById('app');
  var r = window.devicePixelRatio || 1;
  v.setAttribute('browser-config', JSON.stringify({
    pixelRatio: r,
    pixelWidth: Math.round(window.innerWidth * r),
    pixelHeight: Math.round(window.innerHeight * r),
  }));
</script>
```

`viewportBrowserConfig(view)` computes the same object if you'd rather assign
`view.browserConfig` yourself; it returns `null` when nothing is measurable.
web-core freezes `SystemInfo` when the view is constructed, so resizes are not
tracked.

## Upstream coupling

Relies on web-core's `NativeModules.bridge` worker module and the
`<lynx-view>` `onNativeModulesCall` / `globalProps` / `updateGlobalProps` /
`sendGlobalEvent` surface (an existing handler is preserved — non-`sigx.*`
calls fall through to it). Tested against the `@lynx-js/web-core` version
range pinned by `@sigx/lynx-cli`.

## License

MIT
