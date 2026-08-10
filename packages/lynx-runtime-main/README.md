# @sigx/lynx-runtime-main

Main-thread (Lepus) runtime for [SignalX](https://sigx.dev/lynx/) on Lynx. Receives the op stream from `@sigx/lynx-runtime`, mutates the native render tree via Lynx PAPI, and runs `'main thread'`-marked worklets at the host's display refresh rate.

> Application code rarely imports from this package directly. The build pipeline ([`@sigx/lynx-plugin`](https://sigx.dev/lynx/modules/plugin/overview/)) wires it into the main-thread bundle automatically.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/runtime-main/overview/](https://sigx.dev/lynx/modules/runtime-main/overview/)**

## Responsibilities

- **`entry-main.ts`** — installs `globalThis.processData`, `renderPage`, `updatePage`, `sigxPatchUpdate`, `sigxRunOnMT`, and `runOnBackground`. This is the file the build plugin lists as the first import in the MT bundle so the Lynx runtime finds the global hooks it expects.
- **`ops-apply.ts`** — the `applyOps` loop that consumes the BG → MT op stream (`CREATE`, `INSERT`, `SET_STYLE`, `SET_WORKLET_EVENT`, `INIT_MT_REF`, `REGISTER_AV_BRIDGE`, ...) and translates them into PAPI calls (`__CreatePage`, `__SetInlineStyles`, `__AddEvent`, etc.).
- **`MTElementWrapper`** — high-level wrapper your worklets drive via `mainThreadRef.current.method(...)` (`setStyleProperties`, `getComputedStyleProperty`, `animate`, `invoke`, query selectors).
- **Hybrid worklet dispatch** — the slot machine in `event-slots.ts` plus the hybrid context in `hybrid-worklet.ts` lets a single MT slot carry both a worklet handler *and* a BG-side handler for the same event, dispatching to both.
- **AnimatedValue bridge** — `animated-bridge-mt.ts` diffs registered AVs against last-published snapshots and dispatches batched `Lynx.Sigx.AvPublish` events to BG once per `__FlushElementTree` boundary. Registration also arms an auto-flush setter on the SharedValue's MT envelope (`armAvAutoFlush`), so a bare worklet write `sv.current.value = x` schedules a microtask-coalesced flush by itself — `useAnimatedStyle` bindings apply and the publish lands the same frame without a manual `__FlushElementTree()` in gesture code. The matching BG sink lives in `@sigx/lynx-runtime`.
- **`useAnimatedStyle` mapper registry** — `animated-style-mappers.ts` ships built-in mappers (`translateX`, `scale`, `opacity`, ...) and exposes `registerMapper(name, fn)` so MT-side code can add custom ones.
- **Snapshot runtime** — `snapshot-mt.ts` (#620) instantiates compiled snapshot templates on the MT: lazy `ensureElements()` (staged records until first materialization), hole patching through each template's `update[i]`, synthetic negative ids feeding the same event-slot/ref machinery as op-built elements, and the hole-updater hooks installed into `@sigx/lynx-runtime-internal/snapshot` at bootstrap. No production callers yet — the wire protocol and the transform arrive in later #620 phases.
- **Frame-callback driver** — `frame-callbacks-mt.ts` (#933) keeps the registry behind `useFrameCallback` and drives **one** `requestAnimationFrame` chain for every active callback: `requestAnimationFrame` on the MT is a host bridge call, so a chain per callback would multiply bridge traffic for nothing, and one chain gives every callback the same `Date.now()` sample and closes the frame with a single flush (through `scheduleAvFlush`'s shared latch). Each entry's worklet ctx is prototype-rebuilt **once** at registration and then handed to `runWorklet` unchanged, so upstream's identity-keyed hydration cache hits — building a fresh ctx per frame would re-walk `_c`, re-bind, and re-`addRef` every `runOnBackground` handle sixty times a second. It also installs `globalThis.__sigxFrameCallbacks`, the channel the `startFrameCallback` / `stopFrameCallback` worklets use to start and stop a loop from main-thread code.
- **Parked gesture registrations** — `gesture-park.ts` (#958) holds a `SET_GESTURE_DETECTOR` whose element isn't bound yet and replays it, in arrival order, when that wvid binds. The drain lives in `bindMtRef`, not in the `SET_MT_REF` op handler, because elements inside a compiled snapshot template bind through the snapshot runtime and never emit that op — draining from the handler misses most refs in a real app. Registration normally arrives after the ref op, but not when the detector's owner mounts *earlier* than the element it binds to — a screen that measures itself before rendering its content does exactly that. Dropping the op there was silent and permanent: nothing threw, the batch stayed well-formed, and the gesture was simply dead. A REMOVE arriving while the SET is still parked forgets it, so a component that unmounts inside the window doesn't install a gesture for itself afterwards.
- **`mt-ref-bind.ts`** — `MainThreadRef` → element binding (upstream ref map + web style fallback + the wvid → elementId record), shared by the SET_MT_REF op and the snapshot runtime.

## Bootstrap order

Three modules must evaluate in this order on the MT thread:

1. `entry-main` — sets `globalThis.SystemInfo` and the renderer hooks.
2. `@lynx-js/react/worklet-runtime` — installs `lynxWorkletImpl`, `registerWorkletInternal`, `runWorklet`.
3. `install-hybrid-worklet` — registers the hybrid dispatcher into the now-populated worklet map.

`@sigx/lynx-plugin` prepends side-effect imports for these three at the top of every file in the MT bundle, so the order is enforced regardless of which user file the Lynx runtime evaluates first.

## Gotchas

### Diagnostics use `console.*`, not `createLogger` — deliberately

`CONVENTIONS.md` C10 routes package diagnostics through `createLogger('<pkg>')`. This package is the one that opts out, and the reasons are structural rather than stylistic. `__tests__/worklet-logger-capture.test.ts` holds the evidence so the exemption can't rot.

1. **A logger cannot reach a `'main thread'` worklet body.** `createLogger` returns an object of closures over `@sigx/lynx-core`'s module state. The SWC worklet transform does not leave a module-scope reference in place — it rewrites `log.warn(x)` into a `_c` capture (`_c: { log: { warn: log.warn } }`) and the registered body reads `this._c`. `_c` crosses BG → MT as JSON (`@sigx/lynx-runtime`'s `op-queue.ts:133`), and `JSON.stringify` drops function-valued properties, so the capture arrives as `{}`. The first log line in the worklet throws `TypeError: log.warn is not a function` and the rest of the handler never runs — a diagnostic that silently kills the scroll or gesture it was meant to explain.

2. **On the MT there is nothing behind the logger.** The transports that make `createLogger` worth more than `console.*` — `@sigx/lynx-dev-client/install` (the `sigx dev` console streamer) and `@sigx/lynx-observability/install` — are prepended to the **background** layer only (`@sigx/lynx-plugin`'s `entry.ts:747` and `:759`). The main-thread layer's entry list is the user's imports plus the CSS HMR runtime; nothing patches the Lepus console. `log.warn(...)` and `console.warn(...)` land in exactly the same place.

3. **The import isn't free.** `@sigx/lynx-core` publishes no logger subpath — only the barrel — so importing it would pull `@sigx/reactivity` and the whole native bridge into a bundle whose stated job is PAPI bootstrap only.

Every diagnostic here is therefore a bare `console.*` tagged `[sigx-mt]`. To read them, use the platform log (`adb logcat`, Xcode console) — they are not in the `sigx dev` terminal.

## License

MIT
