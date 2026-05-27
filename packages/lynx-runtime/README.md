# @sigx/lynx-runtime

Background-thread renderer for [SignalX](https://github.com/signalxjs) on Lynx. Translates sigx component output into the BG → MT op stream that drives the native render tree.

> Most apps should depend on [`@sigx/lynx`](https://github.com/signalxjs/lynx/tree/main/packages/lynx) instead, which re-exports this package's public surface alongside `@sigx/reactivity` and `@sigx/runtime-core` for a single import path.

## Responsibilities

- **`render` / `lynxMount`** — boot the BG renderer against a `lynx.getJSContext()`-style host.
- **`nodeOps`** — sigx `RuntimeRenderer` adapter that turns vnode operations into op-queue entries.
- **Op queue** — `pushOp`, `scheduleFlush`, `takeOps`, `flushNow` — the wire protocol carrying renders from BG to MT.
- **Main-thread refs** — `MainThreadRef`, `useMainThreadRef` — the BG-side handle whose `.current` value lives on the main thread; the build pipeline serializes these into worklet captures via their `_wvid`.
- **Cross-thread bridges** — `runOnMainThread` (BG→MT one-shot), `runOnBackground` (MT→BG dispatch handle), `transformToWorklet` (handle → JsFn marshal).
- **AnimatedValue BG sink** — `registerBgSink`, `unregisterBgSink`, `ingestAvPublishes` — receive MT-published `AnimatedValue` writes into a `signal`-backed mirror so `effect(() => av.value)` re-runs reactively. The producer side lives in [`@sigx/lynx-gestures`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-gestures); the MT side lives in [`@sigx/lynx-runtime-main`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-runtime-main).
- **JSX types** — `MainThread`, `Define`, `ViewAttributes`, etc.

## Wire protocol

Ops are flat-array tuples produced on BG and consumed on MT. The op codes (`CREATE`, `INSERT`, `SET_STYLE`, `SET_WORKLET_EVENT`, `INIT_MT_REF`, `REGISTER_AV_BRIDGE`, ...) are defined in [`@sigx/lynx-runtime-internal`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-runtime-internal) so both sides stay in sync.

A typical batch:

```ts
[OP.CREATE, 1, 'view',
 OP.SET_STYLE, 1, { width: '100px', height: '100px' },
 OP.INSERT, 0, 1, -1,
 OP.INIT_MT_REF, 7, null,
 OP.SET_MT_REF, 1, 7]
```

Serialized to JSON, shipped via `lynx.getNativeApp().callLepusMethod('sigxPatchUpdate', { data })`, applied by the MT runtime in `@sigx/lynx-runtime-main`.

## Background event bridge

`bg-bridge.ts` listens on `lynx.getCoreContext()` for two MT-originated event types:

- `Lynx.Sigx.PublishEvent` — hybrid worklet → BG event handler dispatch (`<view bindtap={…}>` style).
- `Lynx.Sigx.AvPublish` — coalesced `AnimatedValue` write batches; routed into `ingestAvPublishes`.

## License

MIT
