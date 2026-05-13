# SignalX for Lynx

[Lynx](https://lynxjs.org/) bindings, runtime, CLI plugin, and native modules for [SignalX](https://github.com/signalxjs/core).

## Quick start

```bash
npm create sigx@latest my-app
# pick: lynx (or lynx-tailwind)
cd my-app
pnpm install
pnpm dev
```

Then in another terminal:

```bash
pnpm run:android   # or run:ios
```

## What's in this repo

| Layer | Packages |
|---|---|
| **Framework** | `@sigx/lynx`, `@sigx/lynx-core`, `@sigx/lynx-plugin` |
| **Runtime** | `@sigx/lynx-runtime`, `@sigx/lynx-runtime-main`, `@sigx/lynx-runtime-internal` |
| **CLI plugin** | `@sigx/lynx-cli` (extends `@sigx/cli` with `dev` / `build` / `prebuild` / `doctor` / `run:android` / `run:ios` and ships Lynx templates) |
| **Native modules** | `@sigx/lynx-camera`, `@sigx/lynx-clipboard`, `@sigx/lynx-device-info`, `@sigx/lynx-file-system`, `@sigx/lynx-haptics`, `@sigx/lynx-image-picker`, `@sigx/lynx-linking`, `@sigx/lynx-location`, `@sigx/lynx-navigation`, `@sigx/lynx-network`, `@sigx/lynx-notifications`, `@sigx/lynx-permissions`, `@sigx/lynx-safe-area`, `@sigx/lynx-share`, `@sigx/lynx-storage`, `@sigx/lynx-websocket` |
| **UI / Test** | `@sigx/lynx-daisyui`, `@sigx/lynx-testing` |

## Networking

- **HTTP** — Lynx ships a built-in [`fetch()`](https://lynxjs.org/api/lynx-api/global/fetch.html) global on the BTS runtime, no import or wrapper needed:
  ```ts
  const res = await fetch('https://api.example.com/users');
  const users = await res.json();
  ```
  Caveats vs the browser: no CORS, no `redirect`, no `keepalive`, no `FormData` / `Blob`. Standard `Request` / `Response` / `json()` / `text()` otherwise.
- **WebSocket** — install [`@sigx/lynx-websocket`](./packages/lynx-websocket) and add it to `modules:` in `sigx.lynx.config.ts`. Registers a browser-standard `WebSocket` global backed by `URLSessionWebSocketTask` (iOS) and OkHttp (Android).
- **Connectivity status** — [`@sigx/lynx-network`](./packages/lynx-network) reports online/offline + connection type. Not a transport; pair with `fetch` / `WebSocket`.

## Prerequisites

- Node 22+, pnpm 10+
- For iOS: macOS, Xcode 15+, CocoaPods
- For Android: Android Studio + SDK Platform 34+

## Development

```bash
pnpm install
pnpm build
pnpm test
```

To work against a sibling [`signalxjs/core`](https://github.com/signalxjs/core) checkout, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Releasing

See [RELEASING.md](./RELEASING.md). Publishing is automated via GitHub Actions using npm Trusted Publishing (OIDC) — no `NPM_TOKEN` is stored anywhere.

## License

MIT — © Andreas Ekdahl
