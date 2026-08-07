# FLIK

A two-player flick-the-puck game, and a performance probe for sigx-lynx.

The game half is our take on Sennep's OLO: you put a finger on one of your
discs, slide it anywhere inside your own end of the board, and flick it. How
hard you flick is how hard it goes — there is no aim line and no power meter,
just your hand. The goal is to leave discs resting in your target zone at the
far end, knocking your opponent's out of theirs on the way.

The probe half is why it lives in this repo. Nothing else here drives a
sustained 60 Hz main-thread workload, so nothing else exercises the per-frame
path: a physics loop, N simultaneously animating elements, and a gesture
handing velocity to a simulation. It already produced one framework gap
(`useFrameCallback`, #933).

```sh
pnpm dev              # dev server on :8789 (showcase uses :8788)
pnpm exec sigx run:android
pnpm exec sigx run:ios
pnpm exec sigx run:web
```

## The rules

Portrait board, y down. Five bands, defined once in `src/game/board.ts`:

```
  0.00  ┌──────────────┐
        │    homeB     │  BLUE launches downward from here
  0.13  ├──────────────┤
        │   targetA    │  RED scores here
  0.30  ├──────────────┤
        │              │
        │    field     │
        │              │
  0.70  ├──────────────┤
        │   targetB    │  BLUE scores here
  0.87  ├──────────────┤
        │    homeA     │  RED launches upward from here
  1.00  └──────────────┘
```

That table is the whole ruleset. Because a player's target sits *beyond* the
midline and short of the opponent's home, two of OLO's named rules stop being
rules at all:

- **Overshoot and you are stolen.** Past your target is the opponent's home,
  and a disc resting in a home belongs to that home's owner.
- **Fall short and you reload.** Back in your own home is the same rule,
  spelled the other way.

Both are the one home-zone rule in `settleShot`: *a disc resting in a home zone
belongs to that home's owner, and spends an ember.* Each disc starts with three
embers; at zero it burns out and leaves the board, which is what stops a match
running forever (OLO calls this the death finger).

Resting in a home isn't quite the whole condition, though. A disc is charged
when it either **was the one launched** or **changed which home it is in** —
otherwise the opening line-up would burn down before a shot was fired, since
every disc starts at home. Both halves are load-bearing: the first catches the
launched disc falling short and coming back to where it started, which is a
genuine reload that its start and end positions are identical about; the second
catches a bystander knocked into a home. That is why `GameState` tracks
`launched`.

Six discs each — two big (r=22, mass 1.0) and four small (r=14, mass ~0.405).
Size is felt at both ends of a shot: a big disc leaves your finger slower for
the same flick, because it is the same effort against more mass, and it hits
harder when it arrives, because collision impulses are mass-weighted. Net
momentum still favours it by about half again, so the big ones are the wrecking
balls and the small ones are the ones you can actually place.

Sliding a disc around your own end costs nothing — only the flick commits you,
and a slow release just leaves the disc where you put it. Your score is your
alive discs at rest in your own target zone. The match ends when no disc sits in any home
zone, because at that point nobody can shoot; highest score wins, equal is a
draw.

## Layout

```
src/
  game/     pure background-thread TypeScript. ZERO @sigx imports, so the
            entire ruleset is unit-tested in plain node.
    board.ts   the band table + zoneOf — the single source of truth
    rules.ts   settleShot, scoring, turn order, game over
    setup.ts   opening line-up, and the stress layout
    pack.ts    flat-number codec for the two cross-thread handoffs
  sim/      main-thread worklets. Pure — no bridge calls live here.
    state.ts        the world: structure-of-arrays, preallocated
    integrate.mt.ts friction, position, wall reflection, sleep
    broadphase.mt.ts candidate pairs (all-pairs or uniform grid)
    collide.mt.ts   elastic resolution with unequal masses
    tick.mt.ts      fixed-timestep substeps + the quiescence check
    world.mt.ts     seed / launch / kick
    write.mt.ts     push positions onto elements
    drag.mt.ts      grab / slide / flick — the whole input model
  input/    the gesture that drives drag.mt.ts
  useSimLoop.ts  the frame loop — the ONLY cross-thread traffic during a shot
  render/   the board, the disc layer, the HUD
  theme.ts  palette as hex values (see below)
```

Colours are plain hex, not CSS custom properties: theme `var(--color-*)` used
from an *inline* style paints transparent on Lynx, and the board is almost
entirely inline geometry.

Discs are positioned with `transform: translate(...)` rather than `left`/`top`
— that is the exact property the simulation rewrites each frame.

## How the simulation is arranged

**Ownership is exclusive and phase-switched.** The background thread owns the
board between shots; the main thread owns it during one. There is no merging
step because there is never anything to merge.

```
BG --runOnMainThread(seed)-------------> MT   turn setup
MT --(gesture -> launch, entirely MT)--> MT   no round trip
MT --[simulating: ZERO background traffic]
MT --runOnBackground(onSettle)---------> BG   ONCE, at quiescence
BG --[rules: steal / reload / burn / turn]
```

A ~1.5s shot is roughly 90 frames and sends the background thread **one**
message. That is the baseline the render-path comparison is measured against.

**The physics is split across files, one worklet per phase.** That works
because a captured `'main thread'` worklet resolves to a real callable on the
other side, unlike a captured plain function — which is also why the tuning
constants are *inlined* into the worklet bodies rather than imported.
`tuning.ts` documents them and a test asserts the two haven't drifted.

The payoff is that `'main thread'` is just a string expression statement in
node, so vitest drives the **real** physics functions rather than a copy. There
is no second implementation to keep in sync.

**Fixed timestep** (1/120 s, accumulator, backlog dropped rather than carried).
Chosen for collision stability with unequal masses, for determinism — a
scripted sequence of frame deltas makes the whole simulation a regression test
— and because it decouples simulation rate from render rate, which is the
point of a stress harness. Substeps scale with the fastest disc on the board so
nothing tunnels at the launch cap.

**Friction is Coulomb-primary** (constant deceleration) with a small viscous
term, so pucks stop crisply instead of crawling asymptotically toward zero.

## Status

- [x] **1** — scaffold, ruleset with tests, static board
- [x] **2** — main-thread simulation + the raw render path
- [x] **3** — the flick gesture: grab, slide inside your own end, throw
- [x] **4** — settle contract wired to the ruleset; **playable**
- [x] **5** — perf HUD
- [ ] **6** — render-mode A/B/C toggle
- [ ] **7** — stress mode and the measurement writeup

## The HUD

Two readouts, fed by deliberately different channels so the HUD's own cost is
measurable by switching one off:

- **Sparkline** — one bar per frame, written straight onto the element from the
  frame worklet. One style write per frame regardless of disc count, and no
  background traffic at all. This is the readout to trust while measuring.
- **Numbers** — counters drained to the background thread twice a second. Richer,
  but it crosses the bridge, so it is the half that could distort what it reports.

It reports **two** times, not one, because they answer different questions:
*frame interval* (rAF to rAF) is what the player feels, *tick cost* is what we
spend. Their divergence is the diagnosis — a 4ms tick inside a 33ms frame means
the time is going somewhere we don't control; 28ms inside 33ms means it is our
JavaScript. The HUD says which.

Percentiles come from an 8-bucket histogram, interpolated within the containing
bucket, because the only clock available on the main thread is `Date.now()` at
1ms granularity (there is no `performance.now()` there). A three-decimal p95 off
a 1ms clock would be fiction, so it isn't offered.

### First numbers

Release build, Pixel 9 Pro XL (120Hz), 12 discs, one disc in flight:

```
120fps  p50 6.0  p95 11.4  ·  tick 0.3/1.0ms
```

The simulation costs **0.3ms mean / 1.0ms peak** against an 8.3ms budget — about
4% of the frame at the real game's disc count, with the raw render path. That is
the baseline the A/B comparison (PR 6) and the stress curve (PR 7) get measured
against.

Note the frame callback runs at the display's refresh rate, so a 120Hz panel
gets 120 ticks a second, not 60.

## On measuring this

The full results table lands in PR 7. It will state the device, the OS version, and
the build type, because **numbers from a dev build are fiction here** — and
specifically so, not just as folklore. Upstream's `Element.setStyleProperty`
calls `mainThreadFlushLoopMark` under `__DEV__`, and past 256 entries that does
`trace = trace.slice(trace.length - 256)` on *every style write*. At 200 discs
and 60fps that is roughly 51,000 array copies per frame inside the
instrumentation alone. Grade from `sigx build` only; the HUD carries a
hard-coded banner when it detects a dev build.
