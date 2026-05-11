# @sigx/lynx

Public framework barrel for [SignalX](https://github.com/signalxjs) on Lynx. This is the package you import from in app code — it re-exports everything from `@sigx/reactivity`, `@sigx/runtime-core`, and `@sigx/lynx-runtime` under one namespace.

## Installation

```bash
npm install @sigx/lynx
```

```tsx
import {
  signal, effect, computed, batch,           // reactivity
  component, defineApp, onMounted,            // runtime-core
  useMainThreadRef, runOnMainThread,          // main-thread scripting
  runOnBackground,                            // BG-thread bridge
  useSharedValue, useScrollViewOffset,        // cross-thread state
  useAnimatedStyle,                            // MT style bindings
  type MainThread, type Define,
} from '@sigx/lynx';
```

## What's inside

| Surface                | From                       | Use for                                                       |
| ---------------------- | -------------------------- | ------------------------------------------------------------- |
| `signal`, `effect`, `computed`, `batch`, `untrack`, `watch`, `effectScope` | `@sigx/reactivity` | Reactive state and computations on the BG thread.        |
| `component`, `defineApp`, `defineDirective`, `onMounted`, `onUnmounted`, `onUpdated`, `onCreated`, `provide`/`inject` | `@sigx/runtime-core` | Component model, lifecycle, dependency injection. |
| `useMainThreadRef`, `MainThreadRef` | `@sigx/lynx-runtime` | Refs whose `.current` value lives on the main UI thread. |
| `runOnMainThread`, `runOnBackground`, `transformToWorklet` | `@sigx/lynx-runtime` | Cross-thread function calls. |
| `useSharedValue`, `SharedValue`, `SharedValueState` | `@sigx/lynx-runtime` | **The cross-thread primitive** — MT-writable, BG-observable values (see below). |
| `useAnimatedStyle` | `@sigx/lynx-runtime` | Bind an element style to a `SharedValue` via a named mapper (linear or range-mapped), applied on MT every flush. |
| `OP`, `pushOp`, `scheduleFlush`, `takeOps`, `flushNow` | `@sigx/lynx-runtime` | Lower-level op-queue access for runtime authors. |
| `registerBgSink`, `unregisterBgSink`, `ingestAvPublishes` | `@sigx/lynx-runtime` | Lower-level SharedValue bridge primitives (the building blocks under `useSharedValue`). |
| `MainThread`, `Define`, `ViewAttributes`, etc. | `@sigx/lynx-runtime` | JSX type annotations. |

For touch handling and gesture components (`<Pressable>`, `<Draggable>`, `<Swipeable>`), install [`@sigx/gestures`](../gestures) on top. For spring/tween animation drivers, install [`@sigx/motion`](../motion).

## SharedValue — the cross-thread primitive

`useSharedValue<T>(initial)` returns a value you can **write from a main-thread worklet** and **read reactively from the background thread**.

It's not animation-specific. `SharedValue` is a general "fast state lives on the other thread" primitive. Animation, gestures, scroll, sensors, layout — they're all parallel customers of the same bridge.

```tsx
import { useSharedValue } from '@sigx/lynx';
import { Draggable } from '@sigx/gestures';

const tx = useSharedValue(0);

<Draggable translateX={tx} />
<text>x = {tx.value}px</text>   // BG-reactive, updates per drag frame
```

The MT side mutates `tx.current.value` from inside a `'main thread'` worklet (zero-latency). On every `__FlushElementTree` boundary, the runtime diffs registered values and dispatches a single batched event to the BG thread, where each value lands in a sigx `signal`. A BG `effect(() => sv.value)` re-runs reactively without injecting BG into the gesture hot path.

### Customers of the bridge

| Customer | What it provides | Built on |
| --- | --- | --- |
| Animation | `withSpring`, `withTiming`, `animate` | `@sigx/motion` |
| Gestures | `<Pressable>`, `<Draggable>`, `<Swipeable>` | `@sigx/gestures` |
| Scroll | `<ScrollView offsetY={sv} offsetX={sv}>` | `@sigx/gestures` |
| Style bindings | `useAnimatedStyle(elRef, sv, mapperName, params)` | `@sigx/lynx` |

### Scroll-driven UI example

```tsx
import {
  useSharedValue, useAnimatedStyle, useMainThreadRef,
  type MainThread,
} from '@sigx/lynx';
import { ScrollView } from '@sigx/gestures';

const scrollY = useSharedValue(0);
const heroRef = useMainThreadRef<MainThread.Element | null>(null);

// Parallax: as scroll goes 0 → 300, the hero translates 0 → -150 px.
useAnimatedStyle(heroRef, scrollY, 'translateY', {
  inputRange: [0, 300],
  outputRange: [0, -150],
  extrapolate: 'clamp',
});

<ScrollView offsetY={scrollY}>
  <view main-thread:ref={heroRef}><image src={hero} /></view>
  <text>Body…</text>
  <text>Scroll position (BG-reactive): {scrollY.value.toFixed(0)}px</text>
</ScrollView>
```

Scroll → `<ScrollView>`'s internal MT worklet writes `scrollY.current.value` → flush triggers `useAnimatedStyle`'s mapper and applies the transform → MT publishes the diff to BG → `<text>` updates reactively. End-to-end, never crosses to BG inside the scroll hot path. The user just passes a `SharedValue` — same shape as `<Draggable translateX={tx}>`.

### What this is not

- **Not bidirectional.** Writes from BG (`sv.value = 100`) are no-op'd with a dev warning. Authoritative state lives on MT; BG observes. A bidirectional bridge would be a larger design and isn't currently scoped.

### Differentiator

Neither vue-lynx nor react-lynx ships a BG-observable MT value. React-lynx's `MainThreadRef.current` *throws* on BG; framer-motion-style libraries store animation state in MT-only refs. The diff/publish bridge in `@sigx/lynx-runtime` is what makes `effect(() => sv.value)` work — a primitive unique to sigx-lynx as of 2026-04.

### Deprecation note

Prior to Phase 2.8, `SharedValue` / `useSharedValue` were named `AnimatedValue` / `useAnimatedValue`. The old names still work via deprecated re-exports for one minor cycle. Migrate at your convenience.

## Build pipeline

The `'main thread'` directive transform that powers main-thread event handlers is provided by [`@sigx/lynx-plugin`](../lynx-plugin) — register it in your rspack/rspeedy config.

## License

MIT
