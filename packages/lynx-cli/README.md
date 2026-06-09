# @sigx/lynx-cli

The Lynx plugin for [`@sigx/cli`](https://github.com/signalxjs/cli/tree/main/packages/cli) — adds `dev`, `build`, `prebuild`, `doctor`, `run:android`, `run:ios`, and `run:web` commands for SignalX projects targeting [Lynx](https://lynxjs.org/).

This package is auto-installed when you scaffold a Lynx project:

```bash
npm create @sigx@latest my-app
# pick: lynx (or lynx-tailwind)
```

## What you get

| Command | Description |
|---|---|
| `sigx dev`         | Start the rspeedy dev server with HMR. Claims a stable port (default `8788`) and keeps it across restarts so a running app reconnects and reloads itself automatically. JS `console.*` from running devices is streamed back to the terminal; pass `--no-device-logs` to disable. |
| `sigx build`       | Production bundle for both Lynx runtime tiers |
| `sigx prebuild`    | Generate `ios/` and `android/` native projects from your config + auto-link installed `@sigx/lynx-*` modules |
| `sigx doctor`      | Verify your toolchain (rspeedy, JDK, ADB, Xcode, CocoaPods, devices) |
| `sigx run:android` | `prebuild` → install via Gradle → launch on the connected device |
| `sigx run:ios`     | `prebuild` → `pod install` → build and launch on the iOS simulator |
| `sigx run:web`     | Build the web bundle, serve it in the browser via Lynx for Web, and live-reload on change |

### Dev server reliability

`sigx dev` claims one **stable port per project** (default `8788`) and records
it in `node_modules/.cache/@sigx/lynx-cli/dev-server.json`. On restart it
reclaims the same port from the previous (now-exited) session instead of
walking to a new one, so an already-running app — whose dev-server URL is baked
into its bundle — reconnects to the same address. If a `sigx dev` is **already
running** for the project, a second one refuses to start rather than silently
spawning another server on a different port (stop the first, or pass
`--port <n>`).

Each server run carries a build id. When an app reconnects to a server whose
build id differs from the one in its running bundle (i.e. the server was
restarted), the dev client **reloads itself** to pick up the latest bundle.

The plugin is auto-discovered by `@sigx/cli` because of this entry in its `package.json`:

```json
{
    "sigx-cli": { "plugin": "./dist/plugin.js" }
}
```

## Running on the web

`sigx run:web` runs your app in a desktop browser through upstream
[Lynx for Web](https://lynxjs.org/) (`@lynx-js/web-core`) — handy for quick
previews, sharing a link, or debugging UI with browser devtools. It builds the
web bundle (`rspeedy build --environment web`), then serves it together with the
web-core engine and a generated `<lynx-view>` host page on a local port, and
opens your browser. Edit a source file and the browser reloads automatically.

```bash
sigx run:web                 # build, serve, open the browser, watch for changes
sigx run:web --port 9000     # pick the port (default: 8900)
sigx run:web --no-open       # don't open a browser
sigx run:web --no-watch      # build + serve once, no live reload
sigx run:web --host          # also expose on your LAN
```

Requirements & notes:

- Your `lynx.config.ts` must declare a web environment:
  `environments: { lynx: {}, web: {} }`.
- The page is served with cross-origin-isolation (COOP/COEP) headers, which
  `web-core` needs for `SharedArrayBuffer`. This works on `localhost` (a secure
  context); a plain-http LAN address (`--host`) is **not** isolated, so some
  features may degrade there.
- Live reload is a **full reload** (re-fetch the bundle), not hot-swap — Lynx's
  HMR transport is device-oriented and is off for the web target (matching
  upstream).

## Auto-linking

Native modules under the `@sigx/lynx-*` namespace ship a `signalx-module.json` manifest. `sigx prebuild` discovers these manifests and automatically wires them into the generated iOS / Android projects — no manual `Podfile` or `settings.gradle` edits needed.

To author your own native module, see [Authoring native modules](https://github.com/signalxjs/lynx/blob/main/docs/native-modules.md) (forthcoming).

## Standalone use

You normally don't depend on this package directly — `npm create @sigx@latest` adds it as a dev dependency for Lynx templates. If you're integrating into an existing project:

```bash
pnpm add -D @sigx/cli @sigx/lynx-cli
```

## License

MIT — © Andreas Ekdahl

---

Part of [SignalX for Lynx](https://github.com/signalxjs/lynx) — the SignalX runtime, components, and native modules for building Lynx apps with a React-like API.
