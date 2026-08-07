# FLIK

A two-player flick-the-puck game, and a performance probe for sigx-lynx.

The game half is our take on Sennep's OLO: you drag back from a disc in your
home zone, release, and try to leave it resting in your target zone at the far
end of the board — knocking your opponent's discs out of theirs on the way.

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

Six discs each — two big (r=22, mass 1.0) and four small (r=14, mass ~0.405),
so a big disc shoves a small one meaningfully. Your score is your alive discs
at rest in your own target zone. The match ends when no disc sits in any home
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
  render/   the board, the discs, the HUD
  theme.ts  palette as hex values (see below)
```

Colours are plain hex, not CSS custom properties: theme `var(--color-*)` used
from an *inline* style paints transparent on Lynx, and the board is almost
entirely inline geometry.

Discs are positioned with `transform: translate(...)` rather than `left`/`top`,
even while nothing moves — that is the exact property the simulation rewrites
each frame, so the static board is already laid out the way the moving one will
be.

## Status

- [x] **1** — scaffold, ruleset with tests, static board
- [ ] **2** — main-thread simulation + the raw render path
- [ ] **3** — aim gesture and launch
- [ ] **4** — settle contract wired to the ruleset; playable
- [ ] **5** — perf HUD
- [ ] **6** — render-mode A/B/C toggle
- [ ] **7** — stress mode and the measurement writeup

## On measuring this

The results table lands in PR 7. It will state the device, the OS version, and
the build type, because **numbers from a dev build are fiction here** — and
specifically so, not just as folklore. Upstream's `Element.setStyleProperty`
calls `mainThreadFlushLoopMark` under `__DEV__`, and past 256 entries that does
`trace = trace.slice(trace.length - 256)` on *every style write*. At 200 discs
and 60fps that is roughly 51,000 array copies per frame inside the
instrumentation alone. Grade from `sigx build` only; the HUD carries a
hard-coded banner when it detects a dev build.
