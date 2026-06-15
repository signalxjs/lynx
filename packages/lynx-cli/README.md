# @sigx/lynx-cli

The Lynx plugin for [`@sigx/cli`](https://sigx.dev/cli/) — adds `dev`, `build`, `prebuild`, `doctor`, `run:android`, `run:ios`, and `run:web` commands for SignalX projects targeting [Lynx](https://lynxjs.org/).

This package is auto-installed when you scaffold a Lynx project, so you rarely depend on it directly:

```bash
npm create @sigx@latest my-app
# pick: lynx (or lynx-tailwind)
```

It gives you a single toolchain — start a dev server with HMR and streamed device logs, produce production bundles, generate and auto-link native iOS/Android projects, diagnose your toolchain, and run on a device, simulator, or the browser.

## 📚 Documentation

Full command reference, dev-server and caching details, web target setup and native-module auto-linking → **[sigx.dev/lynx/modules/cli/overview](https://sigx.dev/lynx/modules/cli/overview/)**

## Auto-linking

Native modules under the `@sigx/lynx-*` namespace ship a `signalx-module.json` manifest. `sigx prebuild` discovers these manifests and automatically wires them into the generated iOS / Android projects — no manual `Podfile` or `settings.gradle` edits needed.

To author your own native module, see [Authoring native modules](https://github.com/signalxjs/lynx/blob/main/docs/native-modules.md) (forthcoming).

## Standalone use

You normally don't depend on this package directly — `npm create @sigx@latest` adds it as a dev dependency for Lynx templates. If you're integrating into an existing project:

```bash
pnpm add -D @sigx/cli @sigx/lynx-cli
```

## OTA publishing

`sigx updates:publish` packages a built `.lynx.bundle` into the static-manifest
layout `@sigx/lynx-updates` consumes. The programmatic core is also exported, so
CI can publish **without shelling out and scraping stdout** — `runUpdatesPublish`
(resolves app version / channel from `signalx.config.ts`, then prints a summary)
and the dependency-light `publishUpdate` (re-exported from
[`@sigx/lynx-updates-publisher`](../lynx-updates-publisher), returns structured
`{ updateId, manifestPath, bundleUrl, sha256, … }`):

```ts
import { publishUpdate } from '@sigx/lynx-cli'; // or '@sigx/lynx-updates-publisher'

const { updateId, manifestPath, bundleUrl, sha256 } = await publishUpdate({ cwd: process.cwd() });
```

For CI that only packages a prebuilt artifact, import `@sigx/lynx-updates-publisher`
directly — it pulls only Node built-ins, not this package's build toolchain.

## License

MIT — © Andreas Ekdahl

---

Part of [SignalX for Lynx](https://sigx.dev/lynx/) — the SignalX runtime, components, and native modules for building Lynx apps with a React-like API.
