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
| **Native modules** | `@sigx/lynx-camera`, `@sigx/lynx-clipboard`, `@sigx/lynx-device-info`, `@sigx/lynx-file-system`, `@sigx/lynx-haptics`, `@sigx/lynx-image-picker`, `@sigx/lynx-linking`, `@sigx/lynx-location`, `@sigx/lynx-navigation`, `@sigx/lynx-network`, `@sigx/lynx-notifications`, `@sigx/lynx-permissions`, `@sigx/lynx-safe-area`, `@sigx/lynx-share`, `@sigx/lynx-storage` |
| **UI / Test** | `@sigx/lynx-daisyui`, `@sigx/lynx-testing` |

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
