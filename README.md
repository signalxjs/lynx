# SignalX for Lynx

**The batteries-included way to ship native mobile apps with [SignalX](https://sigx.dev/core/).** Built on [Lynx](https://lynxjs.org/), it covers the whole stack — scaffold, build, run, and ship from one toolchain:

- **One CLI** — `sigx dev` / `sigx build` / `sigx run:ios` / `sigx run:android` / `sigx run:web` / `sigx prebuild` / `sigx doctor`. Scaffold with `npm create @sigx@latest` and be on a device — or in a browser — in minutes.
- **Autolinked native modules** — `pnpm add @sigx/lynx-haptics`, run `sigx prebuild`, done: the native code is linked and even the Android manifest permission is added for you. No pod wiring, no config. 40+ modules, from SQLite, biometrics and camera to maps, video and rich text.
- **Headless-first UI** — behavior and structure ship as headless components on a design-system-neutral foundation ([`lynx-zero`](https://sigx.dev/lynx/modules/zero/overview/)); skin them with the DaisyUI-flavored design system (or the HeroUI-flavored pilot), or bring your own. Plus type-safe navigation, icon sets tree-shaken at build time to the glyphs you actually use, and streaming markdown with a true WYSIWYG editor.
- **A renderer built for 60fps** — dual-thread architecture: gestures and animations run frame-locked on the UI thread via `SharedValue`, even when JS is busy.
- **Logging & observability built in** — a leveled, namespaced logger (`import { createLogger } from '@sigx/lynx'`) whose output streams straight to the `sigx dev` terminal; HTTP requests log timing/TTFB out of the box. Tune it declaratively via `logging` in `signalx.config.ts`, and opt into [`@sigx/lynx-observability`](https://sigx.dev/lynx/) for production error capture and provider-agnostic log/error sinks.
- **Lockstep versioning** — 40+ packages, one version. Any combination at the same range just works together.

The core is one import — `@sigx/lynx` re-exports `@sigx/reactivity`, `@sigx/runtime-core`, and the Lynx dual-thread renderer under a single import path. Everything else is opt-in: install the `@sigx/lynx-*` packages you need, and only what you add ships in your app.

## 📚 Documentation

Full guides, the complete module catalog (40+ packages), API reference and live
examples → **[sigx.dev/lynx](https://sigx.dev/lynx/)**

## Quick start

```bash
npm create @sigx@latest my-app
# pick: lynx (or lynx-tailwind)
cd my-app
pnpm install
pnpm dev
```

Then in another terminal:

```bash
pnpm run:android   # or run:ios
```

## Prerequisites

- Node 22+, pnpm 10+
- For iOS: macOS, Xcode 15+, CocoaPods
- For Android: Android Studio + SDK Platform 34+

## Versioning

All `@sigx/lynx-*` packages ship in **lockstep** — they share one version (the
"Lynx framework version"). Install any combination at the same `X.Y.*` range and
they're guaranteed to work together. See [`RELEASING.md`](RELEASING.md) for the
policy.

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
