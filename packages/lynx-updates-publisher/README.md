# @sigx/lynx-updates-publisher

Programmatic OTA publish for [`@sigx/lynx-updates`](../lynx-updates). Package a
built `.lynx.bundle` into the static-manifest layout the
`StaticManifestProvider` consumes — and get **structured metadata back** instead
of scraping stdout.

This is the core of the `sigx updates:publish` CLI command, factored out so CI
pipelines can publish without shelling out. It depends only on Node built-ins,
so a release job can import it without pulling the CLI's build toolchain.

## Install

```sh
pnpm add -D @sigx/lynx-updates-publisher
```

## Usage

```ts
import { publishUpdate } from '@sigx/lynx-updates-publisher';

const result = await publishUpdate({
    cwd: process.cwd(),
    channel: 'production',
    appVersion: '1.4.2',
    notes: 'Bug fixes.',
});

console.log(result.updateId);     // 'a1b2c3d4e5f60718'
console.log(result.manifestPath); // '<cwd>/updates-dist/production/manifest.json'
console.log(result.bundleUrl);    // 'updates/a1b2c3d4e5f60718/main.lynx.bundle'
console.log(result.sha256);       // 64-hex
// → upload result.manifestPath's directory to your host; point
//   Updates.configure() at <host>/<channel>/manifest.json
```

### Options (`PublishUpdateOptions`)

| Option            | Default                    | Description |
|-------------------|----------------------------|-------------|
| `cwd`             | —                          | Project root (required). |
| `bundle`          | `dist/main.lynx.bundle`    | Bundle path (absolute or relative to `cwd`). |
| `out`             | `updates-dist`             | Output directory. |
| `channel`         | `'production'`             | Release channel. |
| `appVersion`      | `'0.0.0'`                  | JS app version stamped on the entry. |
| `mandatory`       | `false`                    | Mark the update mandatory (blocking install). |
| `notes`           | —                          | Release notes → `metadata.releaseNotes`. |
| `runtimeVersion`  | —                          | Pin the runtime-version fingerprint for **both** platforms. |
| `runtimeVersions` | `.sigx/runtime-versions.json` | Explicit per-platform fingerprints `{ android?, ios? }`. |

Runtime-version resolution order: `runtimeVersion` → `runtimeVersions` →
the `.sigx/runtime-versions.json` sidecar written by `sigx prebuild`. If none
resolve, `publishUpdate` throws with an actionable message.

### Result (`PublishUpdateResult`)

`updateId`, `sha256`, `bundleUrl`, `bundlePath`, `manifestPath`, `channel`,
`appVersion`, `sizeBytes`, `mandatory`, `createdAt`, and the `runtimeVersions`
written this publish.

## Relationship to the CLI

`sigx updates:publish` resolves `appVersion` / default channel from
`signalx.config.ts` (the heavy config loader stays in the CLI), then calls
`publishUpdate` and prints a human summary. Importing this package directly
skips that — pass `appVersion` / `channel` yourself (or accept the defaults).
