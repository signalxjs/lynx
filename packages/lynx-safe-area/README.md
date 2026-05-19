# @sigx/lynx-safe-area

Safe-area insets (notch, home indicator, status bar, navigation bar, keyboard) for sigx-lynx. Native publisher on iOS + Android emits insets every time they change; the JS side surfaces them as a reactive BG signal, four per-edge `SharedValue`s for MT-driven layout, and CSS variables for utility-class styling.

Mirrors React Native's `react-native-safe-area-context` API where it makes sense, but built for sigx-lynx's two-thread model so layout-bound insets don't bounce through the bridge.

## Install

```bash
pnpm add @sigx/lynx-safe-area
```

`sigx prebuild` auto-discovers the package, copies `SafeAreaPublisher.swift` / `SafeAreaPublisher.kt` into your `ios/` and `android/` source trees, and registers them in the auto-generated `GeneratedLifecyclePublishers.{swift,kt}` so they attach to every `LynxView` before first paint. No additional native wiring required.

## Quick start

Wrap your app once, anywhere above the views that need insets:

```tsx
import { defineApp } from '@sigx/lynx';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';

defineApp(() => () => (
    <SafeAreaProvider>
        <SafeAreaView edges={['top', 'bottom']} class="bg-base-100">
            <PageContent />
        </SafeAreaView>
    </SafeAreaProvider>
));
```

`<SafeAreaView>` reactively applies the current insets as `padding` (default) or `margin` to the configured `edges`. Inset-aware first paint: insets are seeded synchronously from `lynx.__globalProps` before render, so there's no flash of unsafe content.

**Sensible layout defaults** — `<SafeAreaProvider>` defaults its host
view to `height: 100vh` + `flex-direction: column`, and `<SafeAreaView>`
defaults to flex-fill long-form. Consumers don't need to add inline
`height: '100vh'` anchors or `flex-1` classes for the layout chain to
work. Pass `style={…}` to override.

## API

### `<SafeAreaProvider>`

Provides the context that hooks consume. Mount once at the app root.

| Prop    | Type                              | Notes                                       |
| ------- | --------------------------------- | ------------------------------------------- |
| `class` | `string`                          | Forwarded to the host `<view>`.             |
| `style` | `Record<string, string \| number>` | Merged after the auto-injected CSS vars.   |

The host view exposes the current insets as CSS variables (`--sat`, `--sar`, `--sab`, `--sal`, `--safe-area-keyboard`) — handy for utility-class consumers:

```tsx
<SafeAreaProvider>
    <view class="pt-[var(--sat)] pb-[var(--sab)]">…</view>
</SafeAreaProvider>
```

### `<SafeAreaView>`

Drop-in container that applies insets as padding or margin.

| Prop    | Type                              | Default                          |
| ------- | --------------------------------- | -------------------------------- |
| `edges` | `('top' \| 'right' \| 'bottom' \| 'left')[]` | All four sides           |
| `mode`  | `'padding' \| 'margin'`           | `'padding'`                      |
| `class` | `string`                          | —                                |
| `style` | `Record<string, string \| number>` | Merged after inset styles       |

Implementation note: applies insets via inline style (BG signal), not via `useAnimatedStyle`. `setStyleProperties` writes that affect layout fire **after** the first layout pass, and children that capture their frame eagerly (notably `<scroll-view>`) don't reflow when insets arrive that way. Inline style avoids the timing trap.

### `useSafeAreaInsets()`

```ts
function useSafeAreaInsets(): PrimitiveSignal<EdgeInsets> | Computed<EdgeInsets>;
```

Returns a BG-side reactive signal of `EdgeInsets`. Components calling this re-render on every inset change (rotation, keyboard show/hide, split-view resize on iPad).

```tsx
const insets = useSafeAreaInsets();
return () => <view style={{ paddingTop: `${insets.value.top}px` }}>…</view>;
```

If no `<SafeAreaProvider>` is in scope, returns a signal seeded with `ZERO_INSETS` and warns in dev (so test/storybook fragments degrade gracefully instead of throwing).

### `useSafeAreaSharedValues()`

```ts
function useSafeAreaSharedValues(): {
    top: SharedValue<number>;
    right: SharedValue<number>;
    bottom: SharedValue<number>;
    left: SharedValue<number>;
} | null;
```

Per-edge `SharedValue`s for MT-driven `useAnimatedStyle` bindings. Use when an animation or gesture worklet needs the current inset on MT without a BG round-trip. Returns `null` outside of `<SafeAreaProvider>`.

### `useSafeAreaFrame(viewportWidth, viewportHeight)`

```ts
function useSafeAreaFrame(
    viewportWidth: number,
    viewportHeight: number,
): Computed<{ x: number; y: number; width: number; height: number }>;
```

Computed inner safe frame — `(x, y)` origin and `width`/`height` of the rect inside the insets. Useful for absolute-positioned overlays and modal bounds that need to know "the visible content rect", not just inset deltas.

`viewportWidth`/`viewportHeight` are caller-supplied (typically a one-time read via `@sigx/lynx-device-info`); the safe-area module deliberately doesn't pull device-info as a transitive dependency.

### `useSafeAreaInsetsMT()`

```ts
function useSafeAreaInsetsMT(): EdgeInsets;
```

Synchronous read from inside a `'main thread'`-marked worklet. Reads `lynx.__globalProps` directly — there's no signal subscription, so callers re-evaluate per worklet invocation rather than reactively. For declarative MT-driven layout the recommended path is `<SafeAreaView>` (which composes `useSafeAreaSharedValues()` with `useAnimatedStyle`).

### Types

```ts
interface EdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
    /** IME (soft keyboard) height when visible, 0 when hidden. */
    keyboard: number;
    /** Status-bar height. Often equal to `top`, but on notched devices the
     *  safe-area top includes the notch and `statusBar` is the smaller
     *  status-only inset. */
    statusBar: number;
    /** Navigation-bar height (Android gesture/3-button nav at bottom). */
    navigationBar: number;
}

const ZERO_INSETS: EdgeInsets;
```

All values are in dp/pt (logical pixels), not raw pixels.

### Lower-level escape hatches

```ts
import { readGlobalSafeArea, GLOBAL_PROPS_KEY } from '@sigx/lynx-safe-area';
```

- `readGlobalSafeArea()` — synchronous one-shot read from `lynx.__globalProps`. Returns `EdgeInsets` (zeros if the publisher hasn't run yet). What `<SafeAreaProvider>` uses to seed initial values.
- `GLOBAL_PROPS_KEY` — the key the native publisher writes under. Exported for tests/debugging.

## CSS variables

The provider's host view exposes these on the element style — descendant selectors inherit them via the cascade:

| Variable                | Maps to                                  |
| ----------------------- | ---------------------------------------- |
| `--sat`                 | `insets.top` (in px)                     |
| `--sar`                 | `insets.right`                           |
| `--sab`                 | `insets.bottom`                          |
| `--sal`                 | `insets.left`                            |
| `--safe-area-keyboard`  | `insets.keyboard`                        |

Works uniformly across iOS and Android — upstream's `env(safe-area-inset-*)` is iOS-only, so this is what you reach for if you're using DaisyUI/Tailwind utilities like `pt-[var(--sat)]`.

## How it works

```
┌──────────────────────────────────────┐
│ Native (iOS UIView / Android View)   │
│ - SafeAreaPublisher attached to      │
│   LynxView at construction           │
│ - On each insets/keyboard change:    │
│   ┌──────────────────────────────┐   │
│   │ updateGlobalProps({safeArea})│   │
│   │ + emit 'safeAreaChanged'     │   │
│   └──────────────────────────────┘   │
└──────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────┐
│ JS (BG thread)                       │
│ ┌─────────────────┐ ┌──────────────┐ │
│ │ readGlobal-     │ │ Global-      │ │
│ │ SafeArea() seed │ │ EventEmitter │ │
│ │ (sync, before   │ │ subscription │ │
│ │  first render)  │ │              │ │
│ └────────┬────────┘ └──────┬───────┘ │
│          │                 │         │
│          ▼                 ▼         │
│      ┌──────────────────────────┐    │
│      │ runOnMainThread worklet  │    │
│      │ writes 4 per-edge SVs    │    │
│      └────────────┬─────────────┘    │
│                   │                  │
│                   ▼                  │
│   SharedValue diff → BG signal       │
│   mirror → computed → re-render      │
│   useSafeAreaInsets() consumers      │
└──────────────────────────────────────┘
```

Why `SharedValue`s for the four edges but a plain `signal` for keyboard/statusBar/navigationBar? The four edges drive layout (`<SafeAreaView>` wants to write padding from a worklet on every flush) and the SV bridge is the right tool for that. The extras are informational — keyboard already lives in `bottom` on iOS, statusBar/navigationBar are decorative — so the SV plumbing isn't worth the cost there.

A custom `safeAreaChanged` event is used instead of upstream's `onGlobalPropsChanged` because the upstream event-name conventions have churned across Lynx releases and we want the contract in our hands.

## Reference app

`examples/lynx-one/my-sigx-app/src/App.tsx` mounts `<SafeAreaProvider>` and a `<SafeAreaView>` for the page chrome — useful as a copy-paste reference and as the smoke-test target when porting the publisher to a new platform.
