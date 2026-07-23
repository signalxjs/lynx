# @sigx/lynx-sheet

The unified bottom sheet for [SignalX for Lynx](https://github.com/signalxjs/lynx) — one detent model, one drag/snap engine, usable with or without routes.

> **Status: landing in stages** (tracking issue [signalxjs/lynx#774](https://github.com/signalxjs/lynx/issues/774)). This package currently ships the pure foundations — the detent model and the worklet-safe drag/snap math. The sheet engine and the standalone `<BottomSheet>` component land next, and `@sigx/lynx-navigation`'s `presentation: 'sheet'` rebuilds on the same engine.

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
        screenH: 800,
        topOffset: 80,       // top inset + header the sheet must never slide under
        bottomInset: 24,     // added back onto keyboard detents (lift values are inset-discounted)
        keyboardPx: 300,     // max observed BG-reactive keyboard lift, 0 if never seen
    },
); // → ascending px, deduped, capped at screenH - topOffset
```

`{ keyboard: true }` owns the math apps used to hand-roll: the remembered keyboard height needs the bottom safe-area inset added back (keyboard *lift* values are inset-discounted while the sheet reaches the true screen bottom), and it must come from a BG-reactive keyboard source — never from reading a main-thread-written SharedValue on the background thread, which stays at its seed value.

## Release math and drag arbitration

Worklet-safe pure functions in reveal-px space (`reveal` = visible sheet height, `0` = hidden):

- `projectReveal(revealPx, velocityY)` — where a release lands if the finger's velocity carries it for `PROJECTION_SEC`. Position projection instead of raw velocity thresholds: a genuine fling projects past the dismiss line from anywhere; a controlled fast drag projects near a detent and settles there.
- `shouldDismiss(revealPx, velocityY, floorPx)` — projected landing under half the floor detent dismisses.
- `nearestDetentIndex(revealPx, velocityY, candidatesPx)` — the settle target on a non-dismiss release.
- `revealDurationSec(heightFraction, fullSlideDurationSec)` — transition duration velocity-matched to the card/modal slide.
- `decideDragOwner(input)` — the full 8-step UNDECIDED → SHEET | CONTENT arbitration for full-surface drags over an inner scrollable (grabber chrome zone, web horizontal-axis gate, rest-lock, at-max scroll cooperation, and the one-way content→sheet mid-gesture handoff).

## License

MIT
