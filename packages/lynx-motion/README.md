# @sigx/lynx-motion

Spring and tween animation drivers for [SignalX](https://github.com/signalxjs) on Lynx, built directly on `SharedValue` from [`@sigx/lynx`](https://github.com/signalxjs/lynx/tree/main/packages/lynx). One customer of the cross-thread bridge alongside gestures and scroll.

The differentiator: animation progress is **observable from the background thread** for free. Mutate a `SharedValue` on MT via `withSpring(sv, target)` — the existing diff/publish bridge ships every frame to a BG-side sigx `signal`, so `effect(() => sv.value)` re-runs reactively.

## Installation

```bash
npm install @sigx/lynx-motion
```

## Quick start

The animation tick runs on MT — all `withSpring` / `withTiming` / `animate` calls must sit inside a `'main thread'` context. The simplest path is `main-thread-bindtap` with a `'main thread'` directive on the handler:

```tsx
import { component, useSharedValue, useAnimatedStyle, useMainThreadRef } from '@sigx/lynx';
import { withSpring, withTiming } from '@sigx/lynx-motion';

const App = component(() => {
  const x = useSharedValue(0);
  const boxRef = useMainThreadRef(null);
  useAnimatedStyle(boxRef, x, 'translateX', { factor: 1 });

  return () => (
    <view>
      <view main-thread:ref={boxRef} style={{ width: 60, height: 60, backgroundColor: '#facc15' }} />

      <view main-thread-bindtap={() => {
        'main thread';
        withSpring(x, 200, { stiffness: 200, damping: 20 });
      }}>
        <text>spring</text>
      </view>

      <view main-thread-bindtap={() => {
        'main thread';
        withTiming(x, 0, { duration: 0.4 });
      }}>
        <text>reset (tween)</text>
      </view>

      {/* BG-reactive — updates per animation frame for free */}
      <text>x = {x.value.toFixed(0)}px</text>
    </view>
  );
});
```

`useAnimatedStyle(elRef, sv, 'translateX')` is required for the bound element to actually move — `withSpring` only writes the SharedValue; the style binding registry is what applies the transform.

## API

### `animate(sv, target, options?)`

Animate a `SharedValue<number>` toward `target`. Returns `{ stop, finished }` controls. **Marked `'main thread'`** — must be called from within a `'main thread'` context.

```ts
const ctrl = animate(tx, 200, { type: 'spring', stiffness: 300, damping: 25 });
// later
ctrl.stop();
await ctrl.finished;  // resolves on completion or cancel
```

`AnimateOptions` extends both `SpringOptions` and `TimingOptions`:

```ts
interface AnimateOptions {
  type?: 'spring' | 'tween';      // default: 'spring' if no duration is set
  // spring physics
  stiffness?: number;             // default 100
  damping?: number;               // default 10
  mass?: number;                  // default 1
  velocity?: number;              // initial velocity, units/sec, default 0
  restSpeed?: number;
  restDelta?: number;
  // tween
  duration?: number;              // seconds, default 0.3
}
```

Default mode is **spring**. Pass `{ type: 'tween' }` or `{ duration }` to get a tween (always uses `easeOut`).

### `withSpring(sv, target, options?)` / `withTiming(sv, target, options?)`

Promise-returning sugar. Use these when you don't need cancellation — they call `animate()` with the type pinned and return `.finished`.

```ts
await withSpring(tx, 200, { stiffness: 200, damping: 20 });
await withTiming(tx, 0, { duration: 0.4 });
```

## Composition

Sigx-native idioms cover the patterns motion's `onUpdate` / `onComplete` callbacks would handle in a callback-shaped library — and they integrate cleanly with sigx's reactivity:

**Per-frame side effects (replaces `onUpdate`):**
```tsx
withSpring(tx, 200);
// BG side — fires reactively per frame via the SharedValue bridge, zero extra wiring:
effect(() => updateUI(tx.value));
```

**Run code on completion (replaces `onComplete`):**
```tsx
'main thread';
await withSpring(sv, 200);
runOnBackground(() => doNext())();
```

**Concurrent animations:**
```tsx
'main thread';
await Promise.all([
  withSpring(x, 200),
  withSpring(y, 100),
  withTiming(opacity, 1, { duration: 0.3 }),
]);
```

**Sequential / chained:**
```tsx
'main thread';
await withSpring(x, 200);
await withTiming(opacity, 0, { duration: 0.2 });
```

**Mass cancellation (drop down to `animate()` for the controls handle):**
```tsx
'main thread';
const ctrls = [
  animate(a, 100),
  animate(b, 200),
  animate(c, 50),
];
// later: stop them all
ctrls.forEach((c) => c.stop());
```

The `__FlushElementTree()` calls each tick performs are coalesced via a microtask flag, so N concurrent animations produce **one flush per frame**, not N. Same pattern upstream's `MTElementWrapper.flushElementTree` uses.

### `spring(options)` — solver factory

Underneath `animate()`. Exposed for advanced use (driving non-SharedValue values, mocking). Returns a `{ next(elapsedMs): { done, value } }` solver. See `src/spring.ts`.

### Easings

Built-in: `linear`, `easeIn`, `easeOut`, `easeInOut`, `circIn`, `circOut`, `circInOut`, `backIn`, `backOut`, `backInOut`, `anticipate`. Plus `cubicBezier(x1, y1, x2, y2)` and the `mirrorEasing` / `reverseEasing` modifiers.

Tween animations always use the built-in `easeOut`. Custom easing functions can't be passed directly: function references don't survive the worklet `_c` capture across the MT/BG bridge — they'd arrive on MT as `undefined`. If you need a non-built-in curve, pick a different built-in.

## Cancellation behavior

Each `SharedValue` has at most one in-flight animation. Calling `animate()` (or `withSpring`/`withTiming`) on a value that already has an animation in flight **cancels the previous one** before starting the new one. The previous animation's `.finished` promise still resolves (cancellation is not an error).

This matches motion's behavior and avoids the race where two ticks fight over the same value.

## Tick scheduling

Animations tick via `requestAnimationFrame`. Lynx's worklet runtime installs `globalThis.requestAnimationFrame` on MT (Lynx SDK ≥ 2.16). Where rAF isn't available — older SDKs, Node test environments — `@sigx/lynx-motion` falls back to `setTimeout(tick, 16)` (≈60 fps).

## Limitations / out of scope

- **Pre-built dist + consumer-app worklet transform.** `@sigx/lynx-motion`
  ships as pre-built JS with `'main thread'` directives baked in.
  `@sigx/lynx-plugin` excludes `/node_modules/` from the SWC worklet
  loader, so consumer apps that import `withSpring` / `withTiming` /
  `animate` get those directives as inert strings — the calls run on
  BG and **silently no-op**. Symptom: animations don't play; final
  values snap into place when the animation duration elapses.
  Workarounds today: (a) pass `animated={false}` to navigators that
  depend on motion, accepting the snap; (b) build your app against
  this package from source rather than the published dist. The
  framework-side fix is a per-package opt-in in the plugin's exclude
  rule and is tracked separately.
- **Scalar `SharedValue<number>` only** for v0.1. 2D values (`{x, y}`) need parallel `animate()` calls (one per axis) for now.
- **No velocity-carry across animations.** When a new `animate()` cancels an in-flight one, the new one starts at velocity 0. Motion's `MotionValue` tracks velocity to support seamless gesture-to-spring handoff; sigx's `SharedValue` doesn't yet (would require extending `SharedValueState<T>` from `{ value }` to `{ value, velocity }`). Add iff a real use case needs it.
- **No duration→physics resolution** (motion's `findSpring`). Spring options are physics-only (stiffness/damping/mass). `{ duration, bounce }` not supported. Add iff users want it.
- **No keyframes / sequences / stagger.** Spring + tween cover gesture-driven UI today.

## Attribution

Spring solver and easing functions are ported from [`@lynx-js/motion`](https://github.com/lynx-family/lynx-stack/tree/main/packages/motion) v0.0.3, [`motion-dom`](https://github.com/motiondivision/motion/tree/main/packages/motion-dom) v12.23.12, and [`motion-utils`](https://github.com/motiondivision/motion/tree/main/packages/motion-utils) v12.23.6 — all Apache-2.0. The cubic bezier code is in turn modified from Gaëtan Renaudeau's [`bezier-easing`](https://github.com/gre/bezier-easing) (MIT).

## License

MIT (sigx adaptation). Ported portions remain under their upstream licenses (Apache-2.0 and MIT, see attribution above).
