# @sigx/lynx-plugin

Rspack/Rspeedy plugin for [SignalX](https://sigx.dev/lynx/) on Lynx. Splits a single user app into the two bundles Lynx requires (background JS + main-thread Lepus) and runs the SWC worklet transform that powers `'main thread'`-marked event handlers.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/plugin/overview/](https://sigx.dev/lynx/modules/plugin/overview/)**

## Installation

```bash
npm install -D @sigx/lynx-plugin
```

```ts
// rspeedy.config.ts (or rspack.config.ts)
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginSigxLynx } from '@sigx/lynx-plugin';

export default defineConfig({
  plugins: [pluginSigxLynx()],
});
```

## What it does

1. **Two-bundle split.** Lynx ships JS to two contexts on the device:
   - The **background bundle** — your sigx components, signals, effects, fetch logic.
   - The **main-thread bundle** — only the worklet handlers extracted from your source, plus the runtime bootstrap.

   The plugin sets up a separate webpack rule so user source files are processed twice: once with the BG-target transform, once with the LEPUS-target transform.

2. **Worklet transform.** Files containing the string `'main thread'` are run through `@lynx-js/react/transform`. The transform:
   - Replaces a worklet expression in the BG bundle with a `{_wkltId, _c}` placeholder so the BG renderer can reference it without shipping the function body.
   - Emits `registerWorkletInternal("main-thread", "<id>", function(...) { ... })` calls into the MT bundle so Lynx native can invoke the worklet body when it dispatches a touch event.
   - Folds the **thread defines** `__MAIN_THREAD__` / `__BACKGROUND__` to literals per layer (BG: `false`/`true`, MT: the inverse) with dead-branch elimination, so `if (__MAIN_THREAD__) { … }` inside a worklet body ships only in the registered MT form and `if (__BACKGROUND__) { … }` only in the BG bundle. Files containing either token are transformed even without a worklet directive. **App/workspace-src only** — published dists pass through the MT layer verbatim (cross-layer module identity), so packages must use a runtime check instead. Types come from `@sigx/lynx/client`.

3. **MT-bundle bootstrap.** Every file in the MT bundle gets three side-effect imports prepended:
   - `@sigx/lynx-runtime-main/entry-main` — installs the `processData` / `renderPage` / `sigxPatchUpdate` globals Lynx expects.
   - `@lynx-js/react/runtime/worklet-runtime/main.js` — populates `lynxWorkletImpl`, `registerWorkletInternal`, `runWorklet`.
   - `@sigx/lynx-runtime-main/install-hybrid-worklet` — registers the hybrid dispatcher used by the `bindtap` + `main-thread-bindtap` slot machine.

   Listing them as separate entries in webpack isn't sufficient because the chunk graph can evaluate user code before the bootstrap chain. Prepending side-effect imports per-file forces the dep-graph order.

4. **Async-chunk plumbing (#599).** Dynamic `import()` emits async chunks
   (`dist/static/js/async/<hash>.js`). The plugin pins the production
   `output.assetPrefix` to `/` (only when you haven't set one) so chunk
   request URLs are root-relative and map 1:1 onto the assets
   `@sigx/lynx-cli`'s release flows embed into the native app, and it logs
   every emitted async chunk after a production build. Set your own
   `output.assetPrefix` to host chunks remotely instead — the generated app
   shells fall back to http(s) for non-local chunk URLs.

5. **Zero-config web environment (#699).** When a web build is requested
   (`sigx run:web` sets `SIGX_WEB_ENV=1` in the rspeedy child env), the plugin
   adds any missing `lynx` / `web` keys to `environments` (creating the block
   when your `lynx.config.ts` declares none) — present keys and every other
   user-declared environment are untouched, and plain `sigx dev` /
   `sigx build` (no env var) are unaffected.
   On the web environment it also injects `__WEB__`/`__NATIVE__` defines,
   `.web.tsx`-style file resolution, and a `.web.js` `extensionAlias` so
   per-package web shims apply through published dists (#697). Opt out with
   `pluginSigxLynx({ web: false })`.

6. **Inline CSS variables (#116).** The plugin encodes
   `enableCSSInlineVariables: true` into the template's page config, so the
   native engine registers CSS custom properties declared in inline `style`
   (`style={{ '--x': '…' }}`) and descendants resolve `var(--x)` from the
   very first paint; value changes re-resolve descendants too. Requires a
   native host on Lynx ≥ 3.9 (the CLI's templates pin 3.9.0; registration
   without change-propagation shipped in 3.6). `@lynx-js/web-core` honors
   inline custom properties unconditionally. Kill switch:
   `pluginSigxLynx({ enableCSSInlineVariables: false })`.

7. **Cross-package worklet pickup.** The worklet rules run on every JS/TS file in the BG / MT layers, including `node_modules` and pre-built `dist/`. Any package shipping `'main thread'` directives in its dist (`@sigx/lynx-motion`, `@sigx/lynx-navigation`, `@sigx/lynx-gestures`, future additions) is picked up automatically — no allowlist or opt-in flag. See [CONTRIBUTING.md](https://github.com/signalxjs/lynx/blob/main/CONTRIBUTING.md#lynx-plugin-internals-cross-package-worklet-pickup) for the loader-branching details.

## Worklet author quick reference

Mark an event handler as MT-thread by adding the directive as the first statement:

```tsx
<view
  main-thread-bindtap={(e) => {
    'main thread';
    elRef.current?.setStyleProperties({ opacity: '0.5' });
  }}
/>
```

The plugin handles the rest — the handler body lives in the MT bundle, the BG bundle keeps a `{_wkltId, _c}` placeholder, and Lynx native dispatches the touch event directly to the MT thread.

For higher-level abstractions (drag, tap, swipe, animations), see [`@sigx/lynx-gestures`](https://sigx.dev/lynx/modules/gestures/overview/).

## Snapshot templates (default ON)

```ts
pluginSigxLynx({ snapshots: false }) // kill switch — keeps the per-element path
```

Compiles static JSX subtrees to **main-thread snapshot templates** (#620): the
main thread constructs each compiled subtree itself from one snapshot op
(instead of ~10 per-element ops + a thread hop), then receives hole-granular
patches. Measured ~25–30x cheaper cell construction on release builds.

- **Default ON** (since #642; `snapshots: false` remains as a kill switch for
  one release). Works in dev and production: under `sigx dev`, template
  registrations ride the MT hot-update bridge, an edit's stale templates are
  purged per file (the id's filename-hash prefix is edit-stable), and op
  batches that outrun a registration park and replay after the next update.
- **JSX must be statically analyzable.** Dynamic parts (attribute expressions,
  children) become numbered holes; the subtree *shape* is fixed at compile
  time. Non-static subtrees keep today's per-element path automatically.
  Whole files using `use:*` directive attributes are pre-filtered to the
  per-element path silently (they panic the upstream WASM pass); only an
  *unexpected* transform failure emits a build warning naming the file that
  fell back. Raw `<list>` JSX compiles: cells are staged instance records
  that `componentAtIndex` materializes synchronously on first pull, and
  offscreen cells recycle through template-keyed pools (`enqueueComponent`
  re-patches a pooled tree instead of constructing).
- **App/workspace-src only.** Published dists ship pre-lowered `_jsx()` calls
  and keep the per-element path.

## Limitations

- **Custom worklet bodies require `'main thread'` directives.** Worklets aren't auto-detected from JSX shape; the directive is the marker.
- **Variables declared inside a worklet body are MT-locals.** They can't cross the bridge via `runOnBackground` closure capture — pass them as arguments instead. See `@sigx/lynx-gestures` README, "Performance notes."
- **Mappers for `useAnimatedStyle` ship as MT-side code.** Custom mappers must be registered from a MT-side module via `registerMapper(name, fn)` — BG-side `useAnimatedStyle` only carries the *name* across the build pipeline.

## License

MIT
