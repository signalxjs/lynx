# @sigx/lynx-keyboard

Soft-keyboard handling for [SignalX](https://github.com/signalxjs) on Lynx, with an API mirroring React Native's (`KeyboardAvoidingView`, `KeyboardStickyView`/`InputAccessoryView`, `useKeyboard`). Keeps a composer input — and an accessory toolbar above it — pinned to the top edge of the on-screen keyboard.

Keyboard height reaches JS through the safe-area bridge ([`@sigx/lynx-safe-area`](../lynx-safe-area)): the native publisher reports the IME height as the `keyboard` inset on every `safeAreaChanged` event. This package turns that inset into ready-made layout primitives — no extra native module needed. Keyboard handling stays a separate concern from safe-area, mirroring the RN ecosystem split (`react-native` core / `react-native-keyboard-controller` vs `react-native-safe-area-context`).

## Installation

```bash
npm install @sigx/lynx-keyboard
```

Requires `<SafeAreaProvider>` (from `@sigx/lynx-safe-area`) at the app root — the same provider every safe-area hook already needs.

## Quick start

The proven chat-screen shape: the content area shrinks (`KeyboardAvoidingView`), the composer bar rides the keyboard (`KeyboardStickyView`). The bar's translate and the area's padding are both `max(0, keyboard - bottomInset)`, so the list bottom always ends exactly where the bar lands.

```tsx
import { KeyboardAvoidingView, KeyboardStickyView } from '@sigx/lynx-keyboard';

const ChatScreen = component(() => () => (
  <view style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
    <KeyboardAvoidingView behavior="padding">
      <scroll-view style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
        {/* messages */}
      </scroll-view>
    </KeyboardAvoidingView>
    <KeyboardStickyView>
      {/* toolbar row (formatting buttons, attachments, …) */}
      {/* input row */}
    </KeyboardStickyView>
  </view>
));
```

Use **one** primitive per subtree: a bar inside both a padding `KeyboardAvoidingView` *and* a `KeyboardStickyView` lifts twice.

## API

### `<KeyboardStickyView>`

Pins its children to the keyboard's top edge with an MT-animated `translateY` (smooth 60fps, no per-frame thread crossing). When the keyboard is closed the bar rests in its natural flex position. Aliases: `KeyboardAccessoryView`, `KeyboardToolbar`.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `offset` | `number` | `0` | Extra gap (dp) above the keyboard. |
| `animated` | `boolean` | `true` | `false` = discrete BG re-render (debug fallback). |
| `discountBottomInset` | `boolean` | `true` | Subtract the bottom safe-area inset from the lift. Keep `true` when an ancestor `<SafeAreaView edges={['bottom']}>` already pads the home indicator. |

Note: the bar's `transform` is controlled internally (the MT binding writes `translateY` via `setStyleProperties`; the non-animated path writes an inline transform). A `transform` passed through `style` will be overridden — wrap children in their own view if you need an additional transform.

### `<KeyboardAvoidingView>`

Wraps content and keeps it above the keyboard. Layout-affecting, so it applies inline BG styles (the same pattern as `<SafeAreaView>` — MT-driven layout writes don't reflow `<scroll-view>`).

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `behavior` | `'padding' \| 'translate' \| 'height'` | `'padding'` | `padding` shrinks the column; `translate` shifts it; `height` appends a spacer. |
| `keyboardVerticalOffset` | `number` | `0` | Added to the computed lift (RN parity). |
| `discountBottomInset` | `boolean` | `true` | Same as on `KeyboardStickyView` — set `false` to lift by the full keyboard height when no ancestor pads the bottom inset. |

### Hooks

- `useKeyboard(): Computed<{ height, visible }>` — BG-reactive keyboard state.
- `useKeyboardLift(discountBottomInset?, offset?): Computed<number>` — the raw lift value.
- `useKeyboardLiftSV(discountBottomInset?, offset?, duration?): SharedValue<number>` — smoothly animated MT SharedValue tracking the lift; bind with `useAnimatedStyle(ref, sv, 'translateY', { factor: -1 })`.

## How it works

- **Height source** — `useSafeAreaInsets().value.keyboard`. There is no separate keyboard event API in Lynx; the safe-area publisher is canonical.
- **The lift** — `max(0, keyboard - bottomInset)`: the keyboard covers the home-indicator region, so a bar that already sits above the bottom inset only needs to rise by the difference. Never add both.
- **BG→MT bridge** — the keyboard inset is a BG-only signal (deliberately not a SharedValue in lynx-safe-area). `useKeyboardLiftSV` watches it from a BG effect and dispatches an MT `withTiming` (from [`@sigx/lynx-motion`](../lynx-motion)) toward each new target; the tween then runs entirely on the main thread.
- **Transform vs layout** — only `translateY` is MT-animated. Padding/height go through inline BG styles because MT layout writes land after the first layout pass and `<scroll-view>` won't reflow.

## Demo

See the **Keyboard lab** screen in [`examples/showcase`](../../examples/showcase) (Settings tab → Keyboard lab).
