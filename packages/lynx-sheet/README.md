# @sigx/lynx-sheet

The unified bottom sheet for [SignalX for Lynx](https://github.com/signalxjs/lynx) — one detent model, one drag/snap engine, usable with or without routes.

> **Status: landing in stages** (tracking issue [signalxjs/lynx#774](https://github.com/signalxjs/lynx/issues/774)). The detent model, the shared engine/pan, and the standalone `<BottomSheet>` component ship today; `@sigx/lynx-navigation`'s `presentation: 'sheet'` rebuilds on the same engine next.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/sheet/overview/](https://sigx.dev/lynx/modules/sheet/overview/)**

## `<BottomSheet>`

A bottom-anchored panel that snaps between detents, follows the finger, rides above the keyboard, and (optionally) dims what's behind it and drag-dismisses — **no route required**, place it in your own layout:

```tsx
import { BottomSheet } from '@sigx/lynx-sheet';

<BottomSheet
    detents={[120, { fraction: 0.45 }, { fraction: 0.9 }]}
    open={open}
    animate                 // default false: JUMP, so external motion (keyboard) does the reveal
    dismissible             // drag/fling below half the floor → parks at 0 + `dismiss` event
    backdrop                // dim tracks the reveal; tap dismisses; inert while parked
    dragMode="surface"      // whole panel drags, arbitrating with an inner gestures <ScrollView>
    topOffset={insets.top + HEADER_H}
    onSnap={(i) => {}}
    onDismiss={() => { open = false; }}   // the sheet only PARKS; the consumer closes it
    slots={{ handle: () => <Grabber />, default: () => <Body /> }}
/>
```

- **Persistent mode** (default): the floor detent is a hard floor — a composer accessory. `open` toggles floor ↔ `openDetentIndex`; pass `liftSV` (`useKeyboardLiftSV()`) so the sheet rides above the keyboard, and `openToLift` to open at the exact live keyboard height (captured on the main thread — the WhatsApp dip-free swap).
- **Dismissible mode**: add `dismissible` (+ `backdrop`) for the modal tray; closing (`open: false`) parks it hidden at reveal 0.
- **Android touch guard**: a plain backdrop blocks Lynx handlers beneath it, but on Android the raw platform touch still reaches native views — an `EditText` under the dim grabs focus + keyboard ([#787](https://github.com/signalxjs/lynx/issues/787)). Fix it by rendering the dim as `@sigx/lynx-gestures`' native touch-guard element: `backdrop={{ guardTag: TOUCH_GUARD_TAG }}` (`import { TOUCH_GUARD_TAG } from '@sigx/lynx-gestures'`). The tag arrives as a string so `@sigx/lynx-sheet` itself stays pure JS; the guard element requires `sigx prebuild`.
- **Drag modes** (mount-constant): `'handle'` (pan on the `handle` slot only — default, safe with raw `<list>` bodies), `'surface'` (full-surface drag with the 8-step scroll arbitration; this component provides the `ScrollDragHost` an inner `@sigx/lynx` `<ScrollView>` adopts), `'grabber'`, `'none'`. The always-drags chrome strip height is `grabberPx` (default 28) — size it to a whole input row for WhatsApp-style sheets.
- **Stacking**: Lynx has no z-index/portal — render the sheet as the LAST child of a full-surface positioned container so the backdrop dims the whole screen.
- **Safe area**: detent resolution reads `useSafeAreaInsets()`/`useKeyboardLift()` — mount a `@sigx/lynx-safe-area` `<SafeAreaProvider>` above the sheet, or `{ keyboard: true }` detents and inset corrections degrade to zero insets (with a dev warning).
- **Rotation**: geometry follows it. `screenH` comes from `useScreen()` ([#856](https://github.com/signalxjs/lynx/issues/856)), so fraction detents and the bottom-edge anchor re-resolve on a rotation or window resize instead of staying pinned to the launch orientation ([#791](https://github.com/signalxjs/lynx/issues/791)).

## Detent model

A sheet declares its resting heights as `DetentSpec[]` and resolves them against a `DetentEnv` to plain ascending px values:

```ts
import { resolveDetents } from '@sigx/lynx-sheet';

const detents = resolveDetents(
    [
        64,                                    // px: the collapsed floor (input row)
        { keyboard: true, fallbackPx: 320 },   // floor riding on the remembered keyboard height
        { fraction: 0.92 },                    // share of screen height
    ],
    {
        screenH: 800,   // `<BottomSheet>` passes the LIVE height (useScreen())
        topOffset: 80,       // top inset + header the sheet must never slide under
        bottomInset: 24,     // added back onto keyboard detents (lift values are inset-discounted)
        keyboardPx: 300,     // max observed BG-reactive keyboard lift, 0 if never seen
    },
); // → ascending px, deduped, capped at screenH - topOffset
```

Invalid specs (a fraction outside `(0, 1]`, a non-positive px) are dropped rather than reinterpreted, and a sheet left with nothing valid falls back to half the screen — `resolveDetents` warns once through the `lynx-sheet` logger namespace when that happens, so the fallback isn't silent.

`{ keyboard: true }` owns the math apps used to hand-roll: the remembered keyboard height needs the bottom safe-area inset added back (keyboard *lift* values are inset-discounted while the sheet reaches the true screen bottom), and it must come from a BG-reactive keyboard source — never from reading a main-thread-written SharedValue on the background thread, which stays at its seed value.

The inset is added back **only by however much of it the sheet still has to cover** — `max(0, bottomInset - bottomOffset)`. A sheet reaching the true screen bottom (`bottomOffset: 0`) covers all of it; one whose ancestor already pads the gesture bar (`bottomOffset: insets.bottom`) covers none, and adding it back there would open the sheet a gesture bar *taller* than the keyboard it replaces — visible as the composer's input row jumping on every keyboard↔panel swap, because that inflated detent is also `openToLift`'s floor and clamps away the live main-thread capture (#811).

## Pinning content to the visible bottom edge

The panel is laid out as tall as the top detent and slid down, so **its own bottom edge is off-screen at every rest below the top detent** — `position: absolute; bottom: 0` pins to a place nobody can see. Pass `pinnedBottomRef` and the sheet binds that element to the inverse of the slide, so it sits last in flow yet paints flush with the bottom of the revealed slice, on the main thread, every frame of a drag or keyboard lift:

```tsx
const tabsRef = useMainThreadRef<MainThread.Element | null>(null);

<BottomSheet pinnedBottomRef={tabsRef} …>
    {/* body stays FULL panel height so a drag never opens a gap under it */}
    <EmojiPicker tabPlacement="bottom" tabBarRef={tabsRef} … />
</BottomSheet>
```

Keeping the body at full panel height is what avoids a gap mid-drag — but it also means the body extends below the fold, so scrollable content needs to know how much is hidden. `onRest` reports the sheet's **settled visible height** in px (mount, `open` toggle, drag settle, dismiss) for exactly that:

```tsx
<BottomSheet onRest={(px) => { restH.value = px; }} … />
// … then e.g. <EmojiPicker gridBottomInset={panelH - restH.value} />
```

`onSnap` says *which* detent; `onRest` says *how tall*.

For the **live** height — tracking the finger frame-for-frame, not just settles —
`onReveal` hands out a `SharedValue<number>` of the effective visible height
(`max(dragged reveal, floor + keyboard lift)`). It may be called on re-renders;
the SharedValue's identity is stable, so capturing it is idempotent. Its flagship
consumer is a chat thread behind the sheet: bind it straight into
`@sigx/lynx-list`'s `bottomInset` and the newest messages ride the sheet
frame-synced through keyboard rises and detent drags (#844):

```tsx
const occluderSV = signal<{ sv: SharedValue<number> | null }>({ sv: null });

<List inverted bottomInset={occluderSV.sv ?? floorH} … />
<BottomSheet onReveal={(sv) => { occluderSV.sv = sv; }} … />
```

## Release math and drag arbitration

Worklet-safe pure functions in reveal-px space (`reveal` = visible sheet height, `0` = hidden):

- `projectReveal(revealPx, velocityY)` — where a release lands if the finger's velocity carries it for `PROJECTION_SEC`. Position projection instead of raw velocity thresholds: a genuine fling projects past the dismiss line from anywhere; a controlled fast drag projects near a detent and settles there.
- `shouldDismiss(revealPx, velocityY, floorPx)` — projected landing under half the floor detent dismisses.
- `nearestDetentIndex(revealPx, velocityY, candidatesPx)` — the settle target on a non-dismiss release.
- `revealDurationSec(heightFraction, fullSlideDurationSec)` — transition duration velocity-matched to the card/modal slide.
- `decideDragOwner(input)` — the full 8-step UNDECIDED → SHEET | CONTENT arbitration for full-surface drags over an inner scrollable (grabber chrome zone, web horizontal-axis gate, rest-lock, at-max scroll cooperation, and the one-way content→sheet mid-gesture handoff).

## License

MIT
