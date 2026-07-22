# @sigx/lynx-runtime

Background-thread renderer for [SignalX](https://sigx.dev/lynx/) on Lynx. Translates sigx component output into the BG → MT op stream that drives the native render tree.

> Most apps should depend on [`@sigx/lynx`](https://sigx.dev/lynx/) instead, which re-exports this package's public surface alongside `@sigx/reactivity` and `@sigx/runtime-core` for a single import path.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/runtime/overview/](https://sigx.dev/lynx/modules/runtime/overview/)**

## Responsibilities

- **`render` / `lynxMount`** — boot the BG renderer against a `lynx.getJSContext()`-style host.
- **`nodeOps`** — sigx `RuntimeRenderer` adapter that turns vnode operations into op-queue entries.
- **Op queue** — `pushOp`, `scheduleFlush`, `takeOps`, `flushNow` — the wire protocol carrying renders from BG to MT.
- **Main-thread refs** — `MainThreadRef`, `useMainThreadRef` — the BG-side handle whose `.current` value lives on the main thread; the build pipeline serializes these into worklet captures via their `_wvid`.
- **Cross-thread bridges** — `runOnMainThread` (BG→MT one-shot), `runOnBackground` (MT→BG dispatch handle), `transformToWorklet` (handle → JsFn marshal).
- **AnimatedValue BG sink** — `registerBgSink`, `unregisterBgSink`, `ingestAvPublishes` — receive MT-published `AnimatedValue` writes into a `signal`-backed mirror so `effect(() => av.value)` re-runs reactively. The producer side lives in [`@sigx/lynx-gestures`](https://sigx.dev/lynx/modules/gestures/overview/); the MT side lives in [`@sigx/lynx-runtime-main`](https://sigx.dev/lynx/modules/runtime-main/overview/).
- **BG globals** — installs web-standard globals the Lynx background thread doesn't expose on its own (engine-version dependent), so web-ported code works unchanged. Currently `queueMicrotask`, polyfilled on `Promise` (some engines, e.g. 3.7 pods, only offer `lynx.queueMicrotask`). Installed first at import, non-clobbering — engines that already expose the global keep theirs.
- **Measurement** — `useElementLayout` (layout events) and `useViewportRect` / `measureViewportRect` (live viewport geometry). See below.
- **`use:*` directives** — element-level lifecycle hooks via the `use:<name>` prop, wired into the renderer; ships the built-in **`show`** directive. See below.
- **JSX types** — `MainThread`, `Define`, `ViewAttributes`, `DirectiveAttribute`, etc.

## Measuring elements

Two hooks, two coordinate spaces — picking the wrong one is a common source of
mis-placed floating UI:

| | `useElementLayout` | `useViewportRect` |
|---|---|---|
| Source | `bindlayoutchange` event | `boundingClientRect` on the main thread |
| Space | layout **page** coords | live **viewport** coords |
| Sees transforms / scroll / `fixed` ancestors | ❌ | ✅ |
| Cost | free (already an event) | async MT round-trip |

Layout events tell you an element's **size** and that **something moved**. They
cannot tell you where an element ended up: a main-thread transform
(`useAnimatedStyle` — a bottom sheet riding the keyboard, a screen mid-
transition), a scroll offset, or a `position: fixed` ancestor all move the
element after layout has spoken.

So anything that decides where it fits on screen — a dropdown flipping above
its trigger, a suggestion list clamping against the keyboard — must measure:

```tsx
const { ref, rect, measure } = useViewportRect();

// Measure when the surface is about to open and whenever the environment
// moves it (layout, keyboard, orientation) — not from a render path.
return () => (
  <view main-thread:ref={ref} bindlayoutchange={() => measure()}>
    {open.value && rect.value ? <Menu anchor={rect.value} /> : null}
  </view>
);
```

Two rules that keep this cheap and correct:

- **Position the surface relative to its container**, and use the measured rect
  only for the flip/clamp decision. The surface then rides along with any
  transform between measurements.
- **Keep the layout frame as the first-paint fallback** (`rect.value ?? layout.value`):
  the measurement lands a frame or two late, and returns nothing on hosts where
  the UI method is unavailable.

From a main-thread handler that already holds the element (a tap that opens a
menu), call `measureViewportRect(el, cb)` directly — same measurement, no
thread hop, and the result can be applied in the same callback that opens the
surface.

## Directives (`use:*`)

Directives attach reusable lifecycle hooks (`created` / `mounted` / `updated` /
`unmounted`) to a host element via a `use:<name>` prop — the lynx counterpart of
runtime-dom's directive system. Define one with `defineDirective` (from
`@sigx/lynx`), typed against `ShadowElement` (the `LynxDirective<T>` alias):

```tsx
import { defineDirective } from '@sigx/lynx';

const autofocus = defineDirective<boolean>({
  mounted(el, { value }) { /* el is a lynx host element */ },
});

<input use:autofocus={true} />               // shorthand (needs registration)
<input use:autofocus={[autofocus, true]} />  // explicit tuple — no registration
```

Register a directive globally with `registerBuiltInDirective(name, def)` or
per-app with `app.directive(name, def)`. Custom `use:*` names always compile;
named built-ins get IntelliSense + value-typing via `JSX.DirectiveAttributeExtensions`.

### `show`

`use:show` toggles an element's visibility via `display` while keeping it
**mounted** — unlike conditional rendering (`{cond && <view/>}`, which unmounts
and remounts). It emits a single style op instead of element create/remove churn
and **preserves native state** (input focus/value, scroll position):

```tsx
<view use:show={isOpen.value}>…</view>
```

Tradeoff: a hidden subtree stays mounted as live native views (memory). Reach for
conditional rendering when the hidden branch is large and rarely shown. `show` is
registered automatically on import; no SSR (`getSSRProps`) hook — lynx is mobile-only.

## Wire protocol

Ops are flat-array tuples produced on BG and consumed on MT. The op codes (`CREATE`, `INSERT`, `SET_STYLE`, `SET_WORKLET_EVENT`, `INIT_MT_REF`, `REGISTER_AV_BRIDGE`, ...) are defined in [`@sigx/lynx-runtime-internal`](https://sigx.dev/lynx/) so both sides stay in sync.

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
