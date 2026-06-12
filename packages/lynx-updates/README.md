# @sigx/lynx-updates

Over-the-air (OTA) bundle updates for sigx-lynx. Ship JS-only releases to
installed apps without a store round-trip — with pluggable backends, every
update mode from fully-automatic to fully-manual, and crash-driven rollback.

```bash
pnpm add @sigx/lynx-updates
sigx prebuild   # links the native module + bakes the runtime fingerprint
```

## Quick start

```tsx
// src/main.tsx
import { defineApp } from '@sigx/lynx';
import { defineUpdates } from '@sigx/lynx-updates';
import App from './App';

defineUpdates({
    provider: { url: 'https://cdn.example.com/myapp/production/manifest.json' },
    mode: 'silent',                    // download now, apply on next launch
    checkOn: ['launch', 'foreground'],
});

defineApp(<App />).mount(null);
```

Publish an update:

```bash
sigx build                       # produces dist/main.lynx.bundle
sigx updates:publish             # writes updates-dist/production/{manifest.json, updates/<id>/...}
# upload updates-dist/production/ to any static host — done.
```

## Update modes

| Mode | Behavior |
|---|---|
| `'silent'` (default) | Auto check + download; the update applies on the next cold launch. |
| `'immediate'` | Auto check + download, then applies immediately via an in-place reload. |
| `'manual'` | Nothing automatic — drive `checkForUpdate()` / `download()` / `apply()` yourself. |

**Mandatory updates** (`mandatory: true` in the manifest, `--mandatory` on
publish) override every mode: `state.mandatory` becomes true (block the UI —
see `<UpdateGate>` in `@sigx/lynx-updates-ui`), and the update downloads and
applies automatically. Opt out with `honorMandatory: false`.

## Runtime-version compatibility

An OTA bundle can only run on a native binary that has the native modules it
expects. `sigx prebuild` computes a **runtime fingerprint** from the linked
native modules' source content, the Lynx SDK version and the scaffold
revision, and bakes it into the binary. `sigx updates:publish` stamps the
same fingerprint into the manifest, and the client refuses mismatches:

- Add/remove/update a native module package → new fingerprint → published
  updates no longer match → ship a store release. The check surfaces this as
  `{ type: 'incompatible' }` / the `incompatibleUpdate` event.
- JS-only changes (any lockstep release that doesn't touch native code) keep
  the fingerprint stable — published updates stay valid.
- Prefer manual control? Pin it: `updates: { runtimeVersion: '1.0.0' }` in
  `signalx.config.ts` (Expo-style — you own the compatibility guarantee).

After a store update, all downloaded OTA updates are dropped automatically
(the binary's fingerprint/versionCode no longer match the recorded state).

## Rollback safety

Updates commit in two phases. A downloaded update is *pending* until the app
signals a healthy boot via `markReady()` — called automatically just after
`configure()` (set `autoMarkReady: false` to gate on your own signal, e.g.
first screen rendered). If the app crashes before `markReady()` on
`rollback.maxFailedLaunches` consecutive launches (default 2), the native
side deletes the update and reverts to the previous bundle. Detect it:

```ts
const { didRollBack } = await Updates.getCurrentlyRunning();
```

## API

```ts
defineUpdates(config)             // boot declaration — sync, idempotent, call before defineApp()
Updates.checkForUpdate()          // → { type: 'update-available' | 'up-to-date' | 'incompatible', ... }
Updates.download(manifest?)       // download + verify + stage for next launch
Updates.apply()                   // apply staged update NOW (in-place reload; only rejects)
Updates.markReady()               // health signal — commits the pending update
Updates.getCurrentlyRunning()     // { updateId, isEmbedded, isFirstLaunchAfterUpdate, didRollBack, ... }
Updates.clearUpdates()            // back to the baked bundle on next launch
Updates.getState() / Updates.addListener(fn) / Updates.isAvailable()
useUpdates()                      // Computed<UpdatesState> for components
```

State machine: `idle → checking → up-to-date | available | incompatible`,
`available → downloading → ready → applying`; failures land in `error` and
every transition fires a typed `UpdatesEvent`.

## Custom backends

The static-manifest provider is ~150 lines over `fetch`. Anything else —
auth, signed manifests, staged rollout services, the Expo Updates protocol —
implements `UpdateProvider` in its own package, no core changes:

```ts
import type { UpdateProvider } from '@sigx/lynx-updates';

const myBackend: UpdateProvider = {
    name: 'my-backend',
    async checkForUpdate(ctx) {
        // ctx: { platform, runtimeVersion, currentUpdateId, embeddedVersion, channel }
        const res = await fetch(`https://updates.example.com/check`, { ... });
        // normalize your protocol's answer to an UpdateManifest
        return { type: 'update-available', manifest };
    },
    async resolveDownload(manifest) {
        return { url: manifest.bundleUrl, sha256: manifest.sha256, headers: { Authorization: '…' } };
    },
};

defineUpdates({ provider: myBackend });
```

The byte transfer always happens natively (streamed to disk with incremental
SHA-256 verification) — providers only decide *what* to download.

## Static manifest format

`sigx updates:publish` maintains this document; serve it from any static host:

```json
{
    "schemaVersion": 1,
    "updates": [{
        "id": "a1b2c3d4e5f60718",
        "version": "1.4.2",
        "channel": "production",
        "platforms": ["android"],
        "runtimeVersion": "fp1-3aa01b2c44de9921",
        "bundleUrl": "updates/a1b2c3d4e5f60718/main.lynx.bundle",
        "sha256": "<64-hex>",
        "mandatory": false,
        "createdAt": "2026-06-12T10:00:00Z",
        "metadata": { "releaseNotes": "Bug fixes." }
    }]
}
```

One URL serves every channel/runtime version: old binaries keep matching
their entries while new binaries pick up new ones. `bundleUrl` may be
relative (resolved against the manifest URL).

## Notes

- **Dev builds**: when running from a dev server URL, OTA is inert (the dev
  server owns the bundle). Baked-bundle debug runs DO consult the update
  store, so rollback can be exercised locally.
- **Web**: no-ops gracefully — every API degrades like the other native
  modules.
- Prebuilt UI (update prompt, blocking gate, progress, restart banner):
  [`@sigx/lynx-updates-ui`](../lynx-updates-ui/README.md).
