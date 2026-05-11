# @sigx/lynx-plugin

Rspack/Rspeedy plugin for [SignalX](https://github.com/signalxjs) on Lynx. Splits a single user app into the two bundles Lynx requires (background JS + main-thread Lepus) and runs the SWC worklet transform that powers `'main thread'`-marked event handlers.

## Installation

```bash
npm install -D @sigx/lynx-plugin
```

```ts
// rspeedy.config.ts (or rspack.config.ts)
import { defineConfig } from '@lynx-js/rspeedy';
import { sigxLynxPlugin } from '@sigx/lynx-plugin';

export default defineConfig({
  plugins: [sigxLynxPlugin()],
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

3. **MT-bundle bootstrap.** Every file in the MT bundle gets three side-effect imports prepended:
   - `@sigx/lynx-runtime-main/entry-main` — installs the `processData` / `renderPage` / `sigxPatchUpdate` globals Lynx expects.
   - `@lynx-js/react/runtime/worklet-runtime/main.js` — populates `lynxWorkletImpl`, `registerWorkletInternal`, `runWorklet`.
   - `@sigx/lynx-runtime-main/install-hybrid-worklet` — registers the hybrid dispatcher used by the `bindtap` + `main-thread-bindtap` slot machine.

   Listing them as separate entries in webpack isn't sufficient because the chunk graph can evaluate user code before the bootstrap chain. Prepending side-effect imports per-file forces the dep-graph order.

4. **Workspace import preservation.** Top-level imports of `@sigx/*` packages (e.g. `import { Draggable } from '@sigx/gestures'`) are preserved as side-effect imports on the MT layer, so workspace component packages that ship MT worklets get walked by webpack and their `registerWorkletInternal` calls land in the MT bundle.

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

For higher-level abstractions (drag, tap, swipe, animations), see [`@sigx/gestures`](../gestures).

## Limitations

- **Custom worklet bodies require `'main thread'` directives.** Worklets aren't auto-detected from JSX shape; the directive is the marker.
- **Variables declared inside a worklet body are MT-locals.** They can't cross the bridge via `runOnBackground` closure capture — pass them as arguments instead. See `@sigx/gestures` README, "Performance notes."
- **Mappers for `useAnimatedStyle` ship as MT-side code.** Custom mappers must be registered from a MT-side module via `registerMapper(name, fn)` — BG-side `useAnimatedStyle` only carries the *name* across the build pipeline.

## License

MIT
