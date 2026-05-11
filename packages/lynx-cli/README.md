# @sigx/lynx-cli

The Lynx plugin for [`@sigx/cli`](https://github.com/signalxjs/cli/tree/main/packages/cli) — adds `dev`, `build`, `prebuild`, `doctor`, `run:android`, and `run:ios` commands for SignalX projects targeting [Lynx](https://lynxjs.org/).

This package is auto-installed when you scaffold a Lynx project:

```bash
npm create sigx@latest my-app
# pick: lynx (or lynx-tailwind)
```

## What you get

| Command | Description |
|---|---|
| `sigx dev`         | Start the rspeedy dev server with HMR |
| `sigx build`       | Production bundle for both Lynx runtime tiers |
| `sigx prebuild`    | Generate `ios/` and `android/` native projects from your config + auto-link installed `@sigx/lynx-*` modules |
| `sigx doctor`      | Verify your toolchain (rspeedy, JDK, ADB, Xcode, CocoaPods, devices) |
| `sigx run:android` | `prebuild` → install via Gradle → launch on the connected device |
| `sigx run:ios`     | `prebuild` → `pod install` → build and launch on the iOS simulator |

The plugin is auto-discovered by `@sigx/cli` because of this entry in its `package.json`:

```json
{
    "sigx-cli": { "plugin": "./dist/plugin.js" }
}
```

## Auto-linking

Native modules under the `@sigx/lynx-*` namespace ship a `sigx-module.json` manifest. `sigx prebuild` discovers these manifests and automatically wires them into the generated iOS / Android projects — no manual `Podfile` or `settings.gradle` edits needed.

To author your own native module, see [Authoring native modules](https://github.com/signalxjs/lynx/blob/main/docs/native-modules.md) (forthcoming).

## Standalone use

You normally don't depend on this package directly — `npm create sigx@latest` adds it as a dev dependency for Lynx templates. If you're integrating into an existing project:

```bash
pnpm add -D @sigx/cli @sigx/lynx-cli
```

## License

MIT — © Andreas Ekdahl
