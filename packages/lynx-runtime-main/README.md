# @sigx/lynx-runtime-main

Main-thread (Lepus) runtime for [SignalX](https://github.com/signalxjs) on Lynx. Receives the op stream from `@sigx/lynx-runtime`, mutates the native render tree via Lynx PAPI, and runs `'main thread'`-marked worklets at the host's display refresh rate.

> Application code rarely imports from this package directly. The build pipeline ([`@sigx/lynx-plugin`](../lynx-plugin)) wires it into the main-thread bundle automatically.

## Responsibilities

- **`entry-main.ts`** — installs `globalThis.processData`, `renderPage`, `updatePage`, `sigxPatchUpdate`, `sigxRunOnMT`, and `runOnBackground`. This is the file the build plugin lists as the first import in the MT bundle so the Lynx runtime finds the global hooks it expects.
- **`ops-apply.ts`** — the `applyOps` loop that consumes the BG → MT op stream (`CREATE`, `INSERT`, `SET_STYLE`, `SET_WORKLET_EVENT`, `INIT_MT_REF`, `REGISTER_AV_BRIDGE`, ...) and translates them into PAPI calls (`__CreatePage`, `__SetInlineStyles`, `__AddEvent`, etc.).
- **`MTElementWrapper`** — high-level wrapper your worklets drive via `mainThreadRef.current.method(...)` (`setStyleProperties`, `getComputedStyleProperty`, `animate`, `invoke`, query selectors).
- **Hybrid worklet dispatch** — the slot machine in `event-slots.ts` plus the hybrid context in `hybrid-worklet.ts` lets a single MT slot carry both a worklet handler *and* a BG-side handler for the same event, dispatching to both.
- **AnimatedValue bridge** — `animated-bridge-mt.ts` diffs registered AVs against last-published snapshots and dispatches batched `Lynx.Sigx.AvPublish` events to BG once per `__FlushElementTree` boundary. The matching BG sink lives in `@sigx/lynx-runtime`.
- **`useAnimatedStyle` mapper registry** — `animated-style-mappers.ts` ships built-in mappers (`translateX`, `scale`, `opacity`, ...) and exposes `registerMapper(name, fn)` so MT-side code can add custom ones.

## Bootstrap order

Three modules must evaluate in this order on the MT thread:

1. `entry-main` — sets `globalThis.SystemInfo` and the renderer hooks.
2. `@lynx-js/react/worklet-runtime` — installs `lynxWorkletImpl`, `registerWorkletInternal`, `runWorklet`.
3. `install-hybrid-worklet` — registers the hybrid dispatcher into the now-populated worklet map.

`@sigx/lynx-plugin` prepends side-effect imports for these three at the top of every file in the MT bundle, so the order is enforced regardless of which user file the Lynx runtime evaluates first.

## License

MIT
