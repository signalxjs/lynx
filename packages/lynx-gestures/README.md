# @sigx/lynx-gestures

Declarative, **frame-locked** gesture and animation primitives for [SignalX](https://sigx.dev/lynx/) on Lynx. Touch handlers, drag/swipe components, and animation linkage all run on the platform's main UI thread — your gestures track the finger at the display refresh rate even when the JS thread is busy fetching, parsing, or re-rendering.

## 📚 Documentation

Full guides, component & hook reference, animation mappers and live examples → **[sigx.dev/lynx/modules/gestures/overview](https://sigx.dev/lynx/modules/gestures/overview/)**

## Why it's interesting

- **Built-in gesture components** — `<Pressable>`, `<Draggable>`, `<Swipeable>`, `<ScrollView>`, `<Swiper>`, `<PinchRotate>` — drop in for instant 60/120 fps interactions, no worklet plumbing in user code.
- **Sheet coordination** — a vertical `<ScrollView>` inside a `@sigx/lynx-navigation` bottom sheet auto-adopts the sheet's `ScrollDragHost`: sheet drags and content scrolling arbitrate like a native bottom sheet (scroll locked below the max detent; pull-down-from-top collapses the sheet), with no wiring in user code.
- **Main-Thread Scripting under the hood** — touch handlers, transform updates, and visual feedback run on Lynx's main thread (Lepus), so gestures don't block on your background JS and don't pay a thread crossing per touchmove.
- **Native pinch & rotation** — `<PinchRotate>` wraps a native `<sigx-pinch>` element that attaches the platform's own recognizers (UIKit `UIPinchGestureRecognizer` / `UIRotationGestureRecognizer`, Android `ScaleGestureDetector` + a rotation tracker) to its backing view and applies the transform on the UI thread. Lynx's gesture arena reserves the pinch/rotation enum slots but ships **no handler** for them in any released version, so `Gesture.Pinch()`/`Gesture.Rotation()` never fire on native — this is the real thing. Requires `sigx prebuild` (it's a native element).
- **Cross-thread observability** — pass a `SharedValue` to a gesture component and read its live position reactively on the background thread via a SignalX `effect`, without injecting BG into the gesture hot path.

## Install

```bash
npm install @sigx/lynx-gestures
```

> Requires `@sigx/lynx` as a peer dependency. The build pipeline (`@sigx/lynx-plugin`) handles the `'main thread'` worklet transform automatically — including for this package's pre-built dist when installed via npm or pnpm.

## A taste

```tsx
import { signal, component, useSharedValue } from '@sigx/lynx';
import { Pressable, Draggable, Swipeable } from '@sigx/lynx-gestures';

const App = component(() => {
  const taps = signal(0);
  const dragX = useSharedValue(0);

  return () => (
    <view>
      <Pressable
        pressedOpacity={0.5}
        pressedScale={0.95}
        onPress={() => { taps.value++; }}
        style={{ width: '100px', height: '100px', backgroundColor: '#3b82f6' }}
      />
      <Draggable
        translateX={dragX}
        snapBack
        onDragEnd={(e) => console.log('released at', e.x, e.y)}
        style={{ width: '90px', height: '90px', backgroundColor: '#a855f7' }}
      />
      <text>BG sees x = {dragX.value}</text>
    </view>
  );
});
```

### Native pinch & rotate

`<PinchRotate>` gives you a real two-finger pinch-zoom + twist backed by the platform's own recognizers. The transform is applied natively (no JS/thread hop), and `change`/`start`/`end` report the live scale/rotation for app logic. It's also *controlled* — drive `scale`/`rotation` from a signal (e.g. a slider) on hosts without multi-touch.

```tsx
import { signal, component } from '@sigx/lynx';
import { PinchRotate } from '@sigx/lynx-gestures';

const Photo = component(() => {
  const scale = signal(1);
  return () => (
    <PinchRotate maxScale={5} scale={scale.value} onChange={(e) => { scale.value = e.scale; }}>
      <image src="photo.jpg" style={{ width: '240px', height: '240px' }} />
    </PinchRotate>
  );
});
```

> `<PinchRotate>` is a **native element** — run `sigx prebuild` after adding this package so the autolinker registers `<sigx-pinch>`. `rotation` is in radians. (Lynx's gesture arena ships no pinch/rotation handler, which is why this can't be a `Gesture.*` builder — see [signalxjs/lynx#418](https://github.com/signalxjs/lynx/issues/418).)

The cross-thread primitives — `useSharedValue`, `SharedValue`, `useAnimatedStyle` — live in [`@sigx/lynx`](https://sigx.dev/lynx/) since 0.3.0; import them from `@sigx/lynx` directly. For the full architecture write-up, the component prop tables, animation mappers, range mapping, custom mappers and performance notes, see the docs site.

## Related

- [`@sigx/lynx`](https://sigx.dev/lynx/) — the framework barrel; import everything from here.
- [`@sigx/lynx-runtime-main`](https://sigx.dev/lynx/modules/runtime-main/overview/) — main-thread runtime and PAPI integration.
- [`@sigx/lynx-plugin`](https://sigx.dev/lynx/modules/plugin/overview/) — the rspack/rspeedy plugin that runs the worklet transform at build time.
- [`@sigx/lynx-motion`](https://sigx.dev/lynx/modules/motion/overview/) — spring/tween animation drivers built on the same `SharedValue` bridge.

## License

MIT
