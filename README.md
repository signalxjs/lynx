# SignalX for Lynx

**The batteries-included way to ship native mobile apps with [SignalX](https://sigx.dev/core/).** Built on [Lynx](https://lynxjs.org/), it covers the whole stack — scaffold, build, run, and ship from one toolchain:

- **One CLI** — `sigx dev` / `sigx build` / `sigx run:ios` / `sigx run:android` / `sigx run:web` / `sigx build:web` / `sigx prebuild` / `sigx doctor`. Scaffold with `npm create @sigx@latest` and be on a device — or in a browser — in minutes.
- **Web included** — the same bundle runs in the browser via [Lynx for Web](https://lynxjs.org/): the gesture system (Tap/LongPress/Pan/Fling/Pinch/Rotation with Race/Simultaneous/Exclusive composition), animations, navigation, appearance, deep links and 9+ native modules all work on web. `sigx run:web` serves it locally with zero config; `sigx build:web` emits a deployable static export (try it on the `examples/showcase` app).
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
npm create @sigx@latest my-app -- --kind lynx --styling daisyui --install
cd my-app
npx sigx doctor
npx sigx run:android
```

`sigx doctor` checks Node, the JDK, the Android SDK, emulators and your package
versions. `sigx run:android` builds the app, installs it and launches it. If
nothing is connected it starts an emulator for you, then keeps the dev server
running with live reload. On macOS, use `npx sigx run:ios` for iOS.

For the interactive wizard, run `npm create @sigx@latest` without flags and
choose **Mobile app**. On older CLI versions it's under **Customize → Native
mobile (Lynx)**.

## Prerequisites

- Node 22+
- For Android: Android Studio (it provides the Android SDK 34+, an emulator,
  and a JDK). Android builds need **JDK 17–26**; if `JAVA_HOME` points at a
  newer or older JDK, sigx uses Android Studio's bundled JDK automatically.
- For iOS: macOS, Xcode 15+, CocoaPods

Something off? `npx sigx doctor` names each problem with a one-line fix, and
`--verbose` on any build command shows the full native build output.

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
