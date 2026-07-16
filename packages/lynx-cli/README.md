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

Native modules under the `@sigx/lynx-*` namespace ship a `signalx-module.json` manifest. `sigx prebuild` discovers these manifests and automatically wires them into the generated iOS / Android projects — no manual `Podfile` or `settings.gradle` edits needed. A manifest can declare dependencies, permissions, services, Info.plist keys, Android Gradle plugins (`android.gradlePlugins`), and iOS code-signing entitlements (`ios.entitlements`); prebuild aggregates and injects them.

Some capabilities need app-supplied credentials that must survive `android/` · `ios/` regeneration. Set these in `signalx.config.ts`: `android.googleServicesFile` (copied to `android/app/google-services.json` for Firebase/FCM) and `ios.entitlements` (merged into the generated `.entitlements`). See the field doc-comments in the config schema for the full set.

To author your own native module, see [Authoring native modules](https://github.com/signalxjs/lynx/blob/main/docs/native-modules.md) (forthcoming).

## Standalone use

You normally don't depend on this package directly — `npm create @sigx@latest` adds it as a dev dependency for Lynx templates. If you're integrating into an existing project:

```bash
pnpm add -D @sigx/cli @sigx/lynx-cli
```

## Release builds with an external pipeline

`sigx run:ios --release` and `sigx run:android --release` build the JS bundle,
embed it into the native project, and archive + launch in one step. When you
archive with an **external** tool instead — fastlane/gym, a plain `xcodebuild
archive`, `gradle bundleRelease`, Xcode Cloud — embed the built bundle yourself
with `sigx prebuild --embed-bundle` so the archive ships the real bundle and not
the empty placeholder:

```bash
sigx build                              # produces dist/main.lynx.bundle
sigx prebuild --ios --embed-bundle      # bakes it into ios/<App>/main.lynx.bundle
xcodebuild -workspace ios/<App>.xcworkspace -scheme <App> archive ...

# Android
sigx prebuild --android --embed-bundle  # bakes it into android/app/src/main/assets/
./gradlew bundleRelease
```

`--embed-bundle` requires a prior `sigx build` and errors if `dist/main.lynx.bundle`
is missing or empty. Plain `sigx prebuild` (without the flag) keeps seeding the
empty iOS placeholder so dev/sandbox builds fall through to the dev server.

### Dynamic `import()` / async chunks

A dynamic `import()` in app code emits an async chunk
(`dist/static/js/async/<hash>.js`). Every embed path above also mirrors those
chunks into the native project — iOS `ios/<App>/LynxAssets/` (a folder
reference registered by prebuild), Android `android/app/src/main/assets/` —
and the generated app shells register production resource fetchers that load
them from there at runtime. Nothing to configure; `sigx build` lists the
emitted chunks in its summary. One caveat: OTA updates don't carry async
chunks (see below).

## Build variants

A single app identity (`name`, `scheme`, `android.applicationId`,
`ios.bundleIdentifier`) means every build shares one application id — so a dev or
staging build **overwrites** the production app on a device. Build variants give
each environment its own identity and its own generated native project, so they
install side by side.

Declare a `variants` map in `signalx.config.ts`:

```ts
export default defineLynxConfig({
  name: 'My App',
  scheme: 'myapp',
  android: { applicationId: 'com.example.app' },
  ios: { bundleIdentifier: 'com.example.app' },

  variants: {
    dev: {
      idSuffix: '.dev',        // → com.example.app.dev (installs beside prod)
      nameSuffix: ' (Dev)',    // home-screen label "My App (Dev)"
      schemeSuffix: 'dev',     // deep-link scheme myappdev:// (no collision)
      // …plus a deep-merged partial override of ANY config field:
      // icon, ios.codeSignStyle, android.adaptiveIcon, infoPlist, updates, …
    },
    pr: { extends: 'dev', idSuffix: '.pr', nameSuffix: ' (PR)' },
  },
});
```

Then pass `--variant <name>` to any native command (or set `SIGX_VARIANT`):

```bash
sigx prebuild --variant dev      # → android-dev/ and ios-dev/
sigx run:android --variant dev   # build + install the dev variant alongside prod
sigx run:ios --variant dev
sigx dev --variant dev
SIGX_VARIANT=dev sigx prebuild   # env fallback for CI / scripts
```

No flag → the base (production) identity into `android/` / `ios/`, exactly as
before.

**What a variant does**

- **Auto-suffixes** the app id + bundle id (`idSuffix`), display name
  (`nameSuffix`), and deep-link scheme (`schemeSuffix`). An explicit `scheme` /
  `android.applicationId` override wins over the suffix.
- **Renders into its own output dir** — `android-<name>/`, `ios-<name>/` — so
  variants never overwrite each other's generated native project. Add
  `android-*/` and `ios-*/` to `.gitignore`.
- **Deep-merges** any other config field (objects merge; arrays/scalars
  replace). `extends: '<other>'` inherits another variant first.
- **Defaults iOS signing to `Automatic`** for non-release variants, so a dev
  build installs on a physical device via a free personal Apple team (no
  provisioning-profile setup). Set `release: true` to keep production signing.
- **Auto-binds the OTA channel** — when `updates` is configured, a variant
  defaults `updates.defaultChannel` to its own name (`dev` → `dev` channel), so
  standalone OTA testing on a variant build just works.
- **Badges the launcher icon** with the variant label (e.g. `DEV`) so it's
  visually distinct on the home screen. Customize with `iconBadge: 'BETA'` or
  disable with `iconBadge: false`.

**Read the active variant at runtime** via `@sigx/lynx`:

```ts
import { variant, isVariant, isBaseBuild } from '@sigx/lynx';

if (!isBaseBuild()) showRibbon(variant.toUpperCase());   // "DEV" / "STAGING"
```

(Baked into the bundle as the `__SIGX_VARIANT__` define; also exposed natively as
the Android `<meta-data com.sigx.VARIANT>` and the iOS `SigxVariant` Info.plist
key. Empty string for the base build.)

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

OTA payloads carry only `main.lynx.bundle` — **not** async chunks from dynamic
`import()`. Since an updated bundle references chunk hashes the installed app
doesn't have embedded, `updates:publish` refuses to run while
`dist/static/js/async/` is non-empty. Convert the dynamic imports to static
ones, or pass `--allow-async-chunks` if your chunks are hosted remotely via a
custom `output.assetPrefix` (the production fetchers fall back to http(s) for
non-local URLs).

## License

MIT — © Andreas Ekdahl

---

Part of [SignalX for Lynx](https://sigx.dev/lynx/) — the SignalX runtime, components, and native modules for building Lynx apps with a React-like API.
