# @sigx/lynx-motion

Spring and tween animation drivers for [SignalX](https://sigx.dev/lynx/) on Lynx, built directly on `SharedValue` from [`@sigx/lynx`](https://sigx.dev/lynx/). One customer of the cross-thread bridge alongside gestures and scroll.

The differentiator: animation progress is **observable from the background thread** for free. Mutate a `SharedValue` on MT via `withSpring(sv, target)` — the existing diff/publish bridge ships every frame to a BG-side sigx `signal`, so `effect(() => sv.value)` re-runs reactively.

## 📚 Documentation

Full API, springs vs tweens, composition, easings and live examples → **[sigx.dev/lynx/modules/motion/overview](https://sigx.dev/lynx/modules/motion/overview/)**

## Install

```bash
npm install @sigx/lynx-motion
```

## A taste

The animation tick runs on MT, so `withSpring` / `withTiming` / `animate` calls must sit inside a `'main thread'` context (e.g. a `main-thread-bindtap` handler):

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
      {/* BG-reactive — updates per animation frame for free */}
      <text>x = {x.value.toFixed(0)}px</text>
    </view>
  );
});
```

The full `animate` / `withSpring` / `withTiming` API, composition patterns (concurrent, sequential, cancellation), the easing set, tick scheduling and current limitations are documented on the docs site.

### Deriving one SharedValue from several

`useDerivedValue(sources, reducer, params?)` folds several source SharedValues into one, on the main thread, recomputed each frame a source changes — bind the result like any SV. Use it to place an element above **whichever of two motions is larger** (two separate `translateY` bindings would *concatenate*, i.e. sum):

```tsx
import { useDerivedValue, useAnimatedStyle } from '@sigx/lynx';

// A chat composer bar that sits above whichever is taller — keyboard or sheet.
const lift = useDerivedValue([keyboardLift, sheetHeight], 'max');
useAnimatedStyle(barRef, lift, 'translateY', { factor: -1 });
```

Built-in reducers: `max`, `min`, `sum`, `scale` (`sources[0] * factor + offset`). Reducers are selected by **name** (the recompute runs in the MT flush loop, which can't invoke a captured closure) — register custom ones on the main thread with `registerReducer(name, fn)` from `@sigx/lynx-runtime-main`. `useDerivedValueReactive(() => ({ sources, reducer, params }))` re-registers on the same derived SV when a runtime-reactive param changes (e.g. a factor that depends on live layout), so consumers bound to it never rebind.

> Two animated-style bindings on one element that emit the same transform function (e.g. two `translateY`) silently **sum** — dev builds now warn once per element and point you to `useDerivedValue`.

Cancellation: a new `animate()`/`withSpring`/`withTiming` on the same `SharedValue` auto-cancels the in-flight one and takes over from the live value. To cancel *without* starting a new animation (e.g. a gesture claiming a value mid-settle), call `cancelAnimation(sv)` from a `'main thread'` context — a plain `sv.current.value` write alone does **not** cancel.

## Attribution

Spring solver and easing functions are ported from [`@lynx-js/motion`](https://github.com/lynx-family/lynx-stack/tree/main/packages/motion) v0.0.3, [`motion-dom`](https://github.com/motiondivision/motion/tree/main/packages/motion-dom) v12.23.12, and [`motion-utils`](https://github.com/motiondivision/motion/tree/main/packages/motion-utils) v12.23.6 — all Apache-2.0. The cubic bezier code is in turn modified from Gaëtan Renaudeau's [`bezier-easing`](https://github.com/gre/bezier-easing) (MIT).

## License

MIT (sigx adaptation). Ported portions remain under their upstream licenses (Apache-2.0 and MIT, see attribution above).
