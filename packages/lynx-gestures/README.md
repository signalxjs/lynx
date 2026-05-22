# @sigx/lynx-gestures

Declarative, **frame-locked** gesture and animation primitives for [SignalX](https://github.com/signalxjs) on Lynx. Touch handlers, drag/swipe components, and animation linkage all run on the platform's main UI thread — your gestures track the finger at the display refresh rate even when the JS thread is busy fetching, parsing, or re-rendering.

## Features

- **Built-in gesture components** — `<Pressable>`, `<Draggable>`, `<Swipeable>` — drop in for instant 60/120 fps interactions, no worklet plumbing in user code.
- **Main-Thread Scripting under the hood** — touch handlers, transform updates, and visual feedback run on Lynx's main thread (Lepus) so gestures don't block on your background JS.
- **Background-thread composables** — `useTap`, `useLongPress`, `usePan`, `usePinch`, `useSwipe`, `useRotation`, `useFling`, `usePanResponder`, and a `useGesture` composer with simultaneous / exclusive / sequential relations.
- **Composition utilities** — `mergeHandlers`, gesture composers, render-prop slots for swipe-to-reveal actions.

## Installation

```bash
npm install @sigx/lynx-gestures
```

> Requires `@sigx/lynx` as a peer dependency. The build pipeline (`@sigx/lynx-plugin`) handles the `'main thread'` worklet transform automatically — including for this package's pre-built dist when installed via npm or pnpm.

## Quick start

```tsx
import { signal, component, useSharedValue } from '@sigx/lynx';
import { Pressable, Draggable, Swipeable } from '@sigx/lynx-gestures';

const App = component(() => {
  const taps = signal(0);
  const dragX = useSharedValue(0);

  return () => (
    <view>
      {/* Tap with instant visual feedback */}
      <Pressable
        pressedOpacity={0.5}
        pressedScale={0.95}
        onPress={() => { taps.value++; }}
        style={{ width: '100px', height: '100px', backgroundColor: '#3b82f6' }}
      />

      {/* Drag at native frame rate; observe position on BG */}
      <Draggable
        translateX={dragX}
        snapBack
        onDragEnd={(e) => console.log('released at', e.x, e.y)}
        style={{ width: '90px', height: '90px', backgroundColor: '#a855f7' }}
      />
      <text>BG sees x = {dragX.value}</text>

      {/* Swipe-to-reveal */}
      <Swipeable
        rightActions={() => <view><text>Delete</text></view>}
        onSwipeOpen={(e) => console.log('opened', e.side)}
      >
        <view><text>Swipe me</text></view>
      </Swipeable>
    </view>
  );
});
```

---

## Why this exists — the architecture

### The two-thread model

Lynx runs your app on two JS contexts:

- **Background (BG) thread** — your component code, signals, effects, fetch/parse, JSX renders.
- **Main (MT) thread** — the renderer's commit thread, where native draw calls happen.

A naive touch handler runs on BG, mutates a signal, triggers a re-render, the renderer diffs styles, queues an op, the op crosses to MT, MT commits. **Two thread crossings per touchmove**, plus a JSX render and a JSON marshal. At 120 Hz touch input, that pipeline can't keep up — the cursor visibly lags the finger and chatters under GC pressure.

### How `@sigx/lynx-gestures` solves it

Gesture components mark their touch handlers as `'main thread'` worklets. The build pipeline extracts those handlers, ships them to MT once at startup, and Lynx native dispatches touch events directly to them. The handler then mutates a `SharedValue` (a thread-aware ref) and calls `setStyleProperties` on the bound element — all on the MT thread, **zero crossings**, no JSX render, no JSON.

### Cross-thread observability

When you pass a `SharedValue` to a gesture component, the MT thread continuously writes to it. A bridge publishes those writes to the BG thread once per native flush (typically per frame), where they land in a `signal`-style mirror. Your `effect(() => sv.value)` re-runs reactively without injecting BG into the gesture hot path.

```
MT thread: tx.current.value = 50   ─┐
MT thread: setStyleProperties(...)  │  one event per flush
   ↓ __FlushElementTree              │  with [wvid, value] tuples
   ↓ flushAvBridgePublishes ────────┘
BG thread: signal value = 50  → effect re-runs, debounce, fetch, etc.
```

---

## Built-in components

### `<Pressable>`

Tap and long-press with optional visual feedback. The opacity and scale flash apply on MT inside the touchstart worklet, so feedback is visually instantaneous.

```tsx
<Pressable
  pressedOpacity={0.5}
  pressedScale={0.95}
  longPressDuration={500}
  onPress={() => doThing()}
  onLongPress={() => doOtherThing()}
  style={{ ... }}
>
  <text>Press me</text>
</Pressable>
```

| Prop                 | Type      | Default | Description                                              |
| -------------------- | --------- | ------- | -------------------------------------------------------- |
| `pressedOpacity`     | `number`  | —       | Opacity to apply on press, restored on release.          |
| `pressedScale`       | `number`  | —       | `scale()` factor on press, restored on release.          |
| `longPressDuration`  | `number`  | `500`   | ms to hold before `onLongPress` fires.                   |
| `maxDistance`        | `number`  | `10`    | Move threshold (px) above which press is cancelled.      |
| `disabled`           | `boolean` | `false` | Suppresses both events and visual feedback.              |
| `onPress`            | event     | —       | Fires on tap (touchend within `maxDistance`).            |
| `onLongPress`        | event     | —       | Fires after `longPressDuration` if still pressed.        |

### `<Draggable>`

Pan-to-translate on the MT thread, with optional axis lock, bounds clamping, snap-back, and `SharedValue` exposure of the position.

```tsx
const tx = useSharedValue(0);
const ty = useSharedValue(0);

<Draggable
  axis="both"
  threshold={4}
  snapBack
  minX={-100} maxX={100}
  translateX={tx} translateY={ty}
  onDragStart={(e) => console.log('start', e.x, e.y)}
  onDragEnd={(e) => console.log('end', e.x, e.y, 'velocity', e.vx, e.vy)}
>
  <view style={{ width: '90px', height: '90px', backgroundColor: '#a855f7' }} />
</Draggable>
```

| Prop                | Type                            | Default | Description                                              |
| ------------------- | ------------------------------- | ------- | -------------------------------------------------------- |
| `axis`              | `'x' \| 'y' \| 'both'`          | `'both'`| Restrict motion to one axis.                             |
| `threshold`         | `number`                        | `0`     | Min distance (px) before recognition fires.              |
| `snapBack`          | `boolean`                       | `false` | Animate back to origin on release.                       |
| `minX`/`maxX`/`minY`/`maxY` | `number`                | —       | Clamp the translation range.                             |
| `translateX`        | `SharedValue<number>`           | —       | External SharedValue the worklet writes on every touchmove. |
| `translateY`        | `SharedValue<number>`           | —       | Same, for the Y axis.                                    |
| `onDragStart`       | event `{ x, y }`                | —       | Fires once per gesture after threshold is met.           |
| `onDragEnd`         | event `{ x, y, vx, vy }`        | —       | Fires on release; includes terminal velocity.            |

### `<Swipeable>`

Horizontal swipe-to-reveal with up to two action panels. Uses `MTElementWrapper.animate()` for the snap, so the easing curve runs on the native compositor.

```tsx
<Swipeable
  leftActions={() => <view style={{ backgroundColor: '#22c55e' }}><text>Archive</text></view>}
  rightActions={() => <view style={{ backgroundColor: '#ef4444' }}><text>Delete</text></view>}
  onSwipeOpen={(e) => console.log('opened', e.side)}
  onSwipeClose={() => console.log('closed')}
>
  <view><text>Row content</text></view>
</Swipeable>
```

| Prop                  | Type                             | Default | Description                                              |
| --------------------- | -------------------------------- | ------- | -------------------------------------------------------- |
| `leftActionsWidth`    | `number`                         | `100`   | Width (px) of the left reveal panel.                     |
| `rightActionsWidth`   | `number`                         | `100`   | Width (px) of the right reveal panel.                    |
| `snapThreshold`       | `number`                         | `40`    | Min translation before snapping to the open position.    |
| `snapDuration`        | `number`                         | `200`   | Snap animation duration (ms).                            |
| `leftActions`         | `() => JSX`                      | —       | Render-prop for the left panel.                          |
| `rightActions`        | `() => JSX`                      | —       | Render-prop for the right panel.                         |
| `onSwipeOpen`         | event `{ side: 'left' \| 'right' }` | —    | Fires when the row snaps open.                           |
| `onSwipeClose`        | event                             | —      | Fires when the row snaps closed from an open position.   |

### `<ScrollView>`

MT-thread `<scroll-view>` wrapper that mirrors scroll position into a `SharedValue`. Pair with `useAnimatedStyle` for parallax / fade / scale effects driven by scroll — all running on MT with zero per-frame thread crossings.

```tsx
import { useSharedValue, useAnimatedStyle, useMainThreadRef } from '@sigx/lynx';
import { ScrollView } from '@sigx/lynx-gestures';

const scrollY = useSharedValue(0);
const headerRef = useMainThreadRef<MainThread.Element | null>(null);

useAnimatedStyle(headerRef, scrollY, 'translateY', {
  inputRange: [0, 300], outputRange: [0, -150], extrapolate: 'clamp',
});

<ScrollView offsetY={scrollY}>
  <view main-thread:ref={headerRef}><image src={hero} /></view>
  <text>Body…</text>
  <text>Scroll: {scrollY.value.toFixed(0)}px</text>
</ScrollView>
```

| Prop                  | Type                             | Default      | Description                                              |
| --------------------- | -------------------------------- | ------------ | -------------------------------------------------------- |
| `offsetY`             | `SharedValue<number>`            | —            | External SharedValue the worklet writes on every scroll. |
| `offsetX`             | `SharedValue<number>`            | —            | Same, for the horizontal axis.                           |
| `scroll-orientation`  | `'vertical' \| 'horizontal'`     | `'vertical'` | Pass-through to `<scroll-view>`.                       |
| `class` / `style`     | string / object                  | —            | Pass-through styling.                                    |

The component handles the inline `'main thread'` worklet, the SharedValue writes, and the `__FlushElementTree()` trigger internally. Users only see `SharedValue`s.

---

### `<Swiper>` and headless dot hooks

`<Swiper>` is a paged horizontal carousel that re-uses the platform's native `<scroll-view paging-enabled>` for snap-to-page (deceleration, overscroll, fling — all free), and writes the live pixel offset into a `SharedValue<number>` on every MT frame. Pair it with the headless `useSwiperDot*` hooks to build any indicator visual.

```tsx
import { useSharedValue } from '@sigx/lynx';
import { signal } from '@sigx/lynx';
import { Swiper, useSwiperDotProgress } from '@sigx/lynx-gestures';

const offset = useSharedValue(0);
const pageIdx = signal({ value: 0 });

<Swiper offset={offset} index={pageIdx} width={pageWidth}>
  <view style={{ width: pageWidth + 'px' }}>…page 1…</view>
  <view style={{ width: pageWidth + 'px' }}>…page 2…</view>
  <view style={{ width: pageWidth + 'px' }}>…page 3…</view>
</Swiper>
```

#### Headless indicator hooks

Every indicator hook returns a `MainThreadRef<MainThread.Element | null>` that you spread onto whatever view you want animated. The hook owns the `useAnimatedStyle` call-site so you don't redo the triangular-window math. Pick one based on which CSS channel you want to drive:

| Hook                       | Channel(s)             | Use case                                    |
| -------------------------- | ---------------------- | ------------------------------------------- |
| `useSwiperDotProgress`     | `opacity`              | Crossfade between two colour layers.        |
| `useSwiperDotScale`        | `scale` (uniform)      | Pulse / grow the active dot symmetrically.  |
| `useSwiperDotGrowX`        | `scaleX` (transform)   | Pill / bar that stretches horizontally.     |
| `useSwiperDotWidth`        | `width` (layout px)    | Same look as `GrowX` but reflows neighbours.|
| `useSwiperDotTranslate`    | `translateX` (track)   | Single thumb that slides across the whole strip. |

Example — a minimal opacity-crossfade dot:

```tsx
const ref = useSwiperDotProgress({ offset, pageWidth, index: i });
<view main-thread:ref={ref} style={{ opacity: '0' }} />
```

For a fully themed indicator (5 ready-made variants — dots, bar, pill, numbered, scale-pulse), use `<SwiperIndicator>` from [`@sigx/lynx-daisyui`](../lynx-daisyui).

---

## Animation primitives

> The cross-thread primitive — `useSharedValue`, `SharedValue`, `useAnimatedStyle` — lives in [`@sigx/lynx`](../lynx#sharedvalue--the-cross-thread-primitive) since 0.3.0. Import from `@sigx/lynx` directly:

### `useSharedValue<T>(initial)` *(from `@sigx/lynx`)*

Allocates a thread-aware value: writeable on MT, reactively observable on BG.

```tsx
import { useSharedValue } from '@sigx/lynx';

const tx = useSharedValue(0);

// MT (inside a 'main thread' worklet)
tx.current.value = 50;

// BG (in component body, effect, computed, JSX)
console.log(tx.value);
effect(() => console.log('tx is now', tx.value));
```

`sv.current.value` is the MT-side read/write path (the underlying `MainThreadRef` envelope). `sv.value` is the BG-side reactive read. Writes on BG are read-only (a dev warning fires); the canonical mutation path is the MT worklet.

The bridge coalesces writes per native flush — N MT mutations within one frame land as one BG event with N tuples.

### `useAnimatedStyle(elRef, sv, mapperName, params?)` *(from `@sigx/lynx`)*

Bind an element's style to a `SharedValue` via a named mapper. The mapper runs on MT every flush where the SharedValue's value changed.

```tsx
import { useMainThreadRef, useSharedValue, useAnimatedStyle } from '@sigx/lynx';

const tx = useSharedValue(0);
const ghostRef = useMainThreadRef<MainThread.Element | null>(null);

useAnimatedStyle(ghostRef, tx, 'translateX', { factor: 0.5 });
useAnimatedStyle(ghostRef, tx, 'opacity', { factor: -0.01, offset: 1 });

<Draggable translateX={tx} />
<view main-thread:ref={ghostRef} style={{ ... }} />
```

The ghost view tracks the draggable at half speed and fades as it moves — without a single thread crossing per frame.

### Built-in mappers

`translateX`, `translateY`, `scale`, and `opacity` accept **either** a linear `{ factor, offset }` shape **or** a range-mapping `{ inputRange, outputRange, extrapolate? }` shape (see "Range mapping" below).

| Name         | Linear param shape                         | Output                                              |
| ------------ | ------------------------------------------ | --------------------------------------------------- |
| `translateX` | `{ factor?: number }`                      | `transform: translateX(value * factor)px`           |
| `translateY` | `{ factor?: number }`                      | `transform: translateY(value * factor)px`           |
| `translate`  | `{ factorX?: number; factorY?: number }`   | `transform: translate(v.x*fx, v.y*fy)px` (2D SharedValue) |
| `scale`      | `{ offset?: number }`                      | `transform: scale(value + offset)`                  |
| `opacity`    | `{ factor?: number; offset?: number }`     | `opacity` clamped to `[0, 1]` of `value*f + o`      |
| `rotate`     | (none)                                     | `transform: rotate(value)deg`                       |

When multiple bindings on the same element produce a `transform`, the parts concatenate in registration order. Other style keys merge; later registrations win on duplicate keys. Whenever **any** binding on an element ticks, **all** of its bindings re-run so partial outputs don't drop the unchanged-axis contribution.

### Range mapping

`translateX` / `translateY` / `scale` / `opacity` also accept `{ inputRange, outputRange, extrapolate? }` — handy for scroll-driven UIs:

```tsx
const { y, onScroll } = useScrollViewOffset();
const headerRef = useMainThreadRef<MainThread.Element | null>(null);

// Parallax: scroll 0..300 → translateY 0..-150, clamped beyond.
useAnimatedStyle(headerRef, y, 'translateY', {
  inputRange: [0, 300], outputRange: [0, -150], extrapolate: 'clamp',
});
```

Multi-stop ranges (length ≥ 2) work — each segment is interpolated independently. `extrapolate: 'clamp'` (default) caps at the endpoints; `'identity'` extends linearly using the slope of the nearest segment.

### Custom mappers

You can register additional mappers from MT-side code:

```tsx
// in a 'main thread'-marked module
import { registerMapper } from '@sigx/lynx-runtime-main';

registerMapper('skewX', (v) => ({ transform: `skewX(${v}deg)` }));
```

Then use the name from BG: `useAnimatedStyle(elRef, sv, 'skewX')`. The string name is what crosses the build pipeline; the function lives on MT.

---

## Background-thread composables

For cases where you don't need MT-thread tracking (state machines that drive non-visual logic, gestures over scroll lists, or coordinating multiple recognizers at once), the package also ships background-thread recognizers exposing `signal`-based state.

| Composable        | Returns                                          |
| ----------------- | ------------------------------------------------ |
| `useTap`          | tap state + handlers; `onTap`, `onDoubleTap`     |
| `useLongPress`    | long-press detection                             |
| `usePan`          | drag distance / velocity                         |
| `usePinch`        | scale, focal point                               |
| `useSwipe`        | direction + distance                             |
| `useRotation`     | two-finger rotation in radians                   |
| `useFling`        | velocity-gated flick                             |
| `usePanResponder` | RN-shape `onStartShouldSet` / `onMove` / etc.    |
| `useGesture`      | composer (simultaneous / exclusive / sequential) |

```tsx
const pan = usePan({
  onMove: (state) => console.log(state.dx, state.dy),
});

<view {...pan.handlers} />
```

These are simpler to compose and fully introspectable on BG, at the cost of a thread crossing per gesture event. For visual feedback (translate, scale, opacity), prefer the MT components above.

---

## Performance notes

- **Avoid changing the gesture component's `style` prop on every render.** A BG-side `SET_STYLE` op for the same element being dragged can clobber MT-side `setStyleProperties` writes. The framework guards this with shallow-equal in the style patcher, so structurally-stable inline styles (`style={{ width: '90px', ... }}`) are fine. Computed-per-render styles touching the dragged element are the case to watch.
- **Pass MT-locals through `runOnBackground` arguments**, not through closure capture. The BG-bound function only sees what crossed the bridge — its parameter list. Capturing a `let side = …` declared inside the worklet body will fail at runtime with `ReferenceError` because BG never had `side`.
- **Per-SharedValue `===` diff coalescing** means object-typed SharedValues (`useSharedValue<{x,y}>`) only publish on identity change, not on property mutation. Use scalar SharedValues and compose them, or use the `translate` mapper which takes a 2D value.

---

## Testing

The package ships source-shape regex tests that verify `'main thread'` directives, handler attribute spellings, and worklet captures are all in place. Run as part of `pnpm test`.

---

## Related

- [`@sigx/lynx`](https://github.com/signalxjs/lynx/tree/main/packages/lynx) — the framework barrel; import everything from here.
- [`@sigx/lynx-runtime-main`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-runtime-main) — main-thread runtime and PAPI integration.
- [`@sigx/lynx-plugin`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-plugin) — the rspack/rspeedy plugin that runs the worklet transform at build time.
- [`@sigx/lynx-motion`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-motion) — spring/tween animation drivers built on the same `SharedValue` bridge.

## License

MIT
