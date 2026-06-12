# @sigx/lynx-updates-ui

Prebuilt OTA update UI for [SignalX](https://sigx.dev/lynx/) on Lynx — the drop-in companion to the headless [`@sigx/lynx-updates`](../lynx-updates) package. Four components cover the whole update lifecycle: a blocking gate for mandatory updates, a prompt modal for optional ones, an inline download progress row, and a "restart to update" banner. All of them read the reactive `useUpdates()` state, so there is nothing to wire up beyond `defineUpdates()`.

Built from [`@sigx/lynx-daisyui`](../lynx-daisyui) building blocks (Modal, Progress, Button, Alert), so everything follows your daisy theme.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/updates/overview/](https://sigx.dev/lynx/modules/updates/overview/)**

## Installation

```bash
pnpm add @sigx/lynx-updates-ui
```

Requires `@sigx/lynx-updates` (configured) and `@sigx/lynx-daisyui` (with its styles in your CSS pipeline). "Later" dismissals persist through `@sigx/lynx-storage` when the native Storage module is present, and degrade to session-only suppression when it isn't.

## Quick start

```tsx
import { component } from '@sigx/lynx';
import { defineUpdates } from '@sigx/lynx-updates';
import { UpdateGate, UpdatePrompt, UpdateReadyBanner } from '@sigx/lynx-updates-ui';

defineUpdates({
  provider: { url: 'https://updates.example.com/manifest.json' },
  mode: 'manual',
});

const App = component(() => () => (
  <UpdateGate description="A required update is being installed.">
    {/* your app */}
    <Screens />

    {/* optional updates: ask, then restart or wait for next launch */}
    <UpdatePrompt applyOn="next-launch" />
    <UpdateReadyBanner />
  </UpdateGate>
));
```

`UpdateGate` blocks only for **mandatory** updates; `UpdatePrompt` and `UpdateReadyBanner` only ever show for **non-mandatory** ones — the three coexist without overlap.

## API

### `<UpdateGate>`

Wraps app content (default slot). Children always render; when `state.mandatory` is true a full-screen overlay covers them: centered title + description, a `Progress` bar bound to the download, "Installing…" while applying, and a Retry button (re-runs `Updates.download()`) on error.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | `'Update required'` | Overlay headline. |
| `description` | `string` | — | Copy under the headline. |
| `class` | `string` | — | Extra class for the overlay. |

Slots: `default` (app content), `blocked` (replaces the built-in overlay entirely — `slots={{ blocked: () => <MyBlockedScreen /> }}`).

### `<UpdatePrompt>`

Modal shown when `status === 'available'` and the update is **not** mandatory. Shows `manifest.version` and `manifest.metadata?.releaseNotes`. "Update" downloads (and, with `applyOn="restart"`, applies immediately); "Later" dismisses and suppresses re-prompts for that update id (persisted, key `__sigx_updates_dismissed:<id>`).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `applyOn` | `'restart' \| 'next-launch'` | `'next-launch'` | When the downloaded update takes effect. |
| `title` | `string` | `'Update available'` | Modal headline. |
| `class` | `string` | — | Extra class for the modal box. |
| `onDismiss` | `() => void` | — | Fired on "Later" (or backdrop tap). |

### `<UpdateProgress>`

Inline `Progress` bar + percent label, rendered only while `status === 'downloading'` (zero-size placeholder otherwise). Falls back to a byte count when the server sent no Content-Length.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `color` | `ProgressColor` | theme default | Bar color (daisy semantic color). |
| `class` | `string` | — | Extra class for the row. |

### `<UpdateReadyBanner>`

Bottom banner when `status === 'ready'` and the update is not mandatory: "Update ready — v1.2.3" plus a Restart button (`Updates.apply()`, in-place reload) and "Later" (hides for this session; the staged update still applies on the next cold launch).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `string` | `'Update ready'` | Banner text (version is appended). |
| `restartLabel` | `string` | `'Restart'` | Restart button text. |
| `class` | `string` | — | Extra class for the banner container. |
| `onDismiss` | `() => void` | — | Fired on "Later". |

### Dismissal helpers

```ts
import { isDismissed, dismiss, DISMISSED_KEY_PREFIX } from '@sigx/lynx-updates-ui';

await isDismissed(manifest.id); // has the user said "Later" to this update?
await dismiss(manifest.id);     // suppress future prompts for it
```

Storage-backed (`@sigx/lynx-storage`); degrades to an in-process Set when the native module is unavailable.
