# @sigx/lynx-navigation

Type-first native navigator for [SignalX](https://sigx.dev/lynx/) on
Lynx. Define routes once with `defineRoutes`, augment the `Register`
interface, and every navigator API — `useNav`, `useParams`, `useSearch`,
`<Link>`, `<Tabs.Screen>`, `<Drawer>` — picks up precise per-route
param/search inference.

The navigator ships native UI primitives (Stack, Tabs, Drawer, modal and
bottom-sheet presentation), focus hooks, deep-link integration, lazy
routes, screen options, and persistence — all reactive via sigx signals,
all typed.

> **Status — 1.0 candidate.** Public surface is frozen; every export is
> locked by the test suite in `__tests__/public-surface.test.ts`.

## 📚 Documentation

Full guides, the complete API reference, presentation modes, nested stacks and live examples → **[sigx.dev/lynx/modules/navigation/overview](https://sigx.dev/lynx/modules/navigation/overview/)**

## Install

```bash
pnpm add @sigx/lynx-navigation
```

Peer-deps: `@sigx/lynx`, `@sigx/lynx-motion`. Optional but recommended:
[`@sigx/lynx-linking`](https://sigx.dev/lynx/modules/linking/overview/) for deep-link wiring,
[`@sigx/lynx-storage`](https://sigx.dev/lynx/modules/storage/overview/) for stack persistence.

## A taste

```tsx
// src/routes.ts
import { defineRoutes } from '@sigx/lynx-navigation';
import { z } from 'zod';
import { Home } from './screens/Home';
import { Profile } from './screens/Profile';

export const routes = defineRoutes({
    home: { component: Home },
    profile: {
        component: Profile,
        params: z.object({ id: z.string() }),
        path: '/users/:id',
    },
});

declare module '@sigx/lynx-navigation' {
    interface Register { routes: typeof routes }
}
```

```tsx
// src/App.tsx
import { NavigationRoot, Stack } from '@sigx/lynx-navigation';
import { routes } from './routes';

export const App = () => (
    <NavigationRoot routes={routes} initialRoute="home">
        <Stack />
    </NavigationRoot>
);
```

From there: typed `useNav()` / `<Link>` navigation, per-tab nested stacks, modal/sheet presentation, focus hooks, deep linking via `useLinkingNav`, and stack persistence via `useNavSerializer`. Full reference, prop tables and runtime gotchas live on the docs site.

Bottom sheets (`presentation: 'sheet'`) drag from anywhere on their surface by default, with drag↔scroll arbitration: taps, input focus and horizontal gestures pass through, and scrollable content coordinates automatically when wrapped in `@sigx/lynx-gestures`' `<ScrollView>` (below the max detent the sheet owns drags and content scroll is locked; at the max detent content scrolls, and pulling down from the top hands the gesture back to the sheet). For raw `<scroll-view>`/`<list>` content that can't coordinate, set `<Screen dragHandle="grabber">` (drag only from the top strip zone) — or `dragHandle="none"` for backdrop/programmatic dismiss only.

`useSheetHeight()` returns a bindable `SharedValue<number>` of the top sheet's live visible height in px (`0` when none, tracking the finger as the sheet drags). Bind it to animate a *sibling* to the sheet — e.g. a chat composer bar that must sit above **whichever is taller**, the keyboard or the sheet: `useDerivedValue([keyboardLift, useSheetHeight()], 'max')` (see `@sigx/lynx-motion`). Returns a constant `0` under `animated={false}`.

`<Screen backdrop={false}>` makes a sheet **non-modal / inline**: no dim, and the region above the sheet surface passes taps straight through to the screen below (the sheet's own layer is translated down to its top edge, so only the backdrop ever covered that region). Use it for a keyboard-accessory panel — an emoji picker sheet under a chat composer whose input must stay tappable while the sheet is open. `backdropDismiss` is then moot (no backdrop to tap); dismiss by dragging down or `nav.pop()`. Default `true` (the modal bottom-sheet look).

`push(name, params, search, { animated: false })` **presents a sheet AT its initial detent instantly** — no slide. Use it to reveal a sheet by some *other* motion: e.g. open an emoji sheet behind the soft keyboard, then blur the input so the keyboard's own dismissal uncovers the sheet (the app animates nothing). `useSheetHeight` reads the detent height from the first frame, so a bar bound to `max(keyboardLift, sheetHeight)` never dips at the swap. A non-animated dismiss (`pop(1, { animated: false })`) returns the height to `0` the same way.

## Inline `<BottomSheet>`

`<BottomSheet>` is a **persistent, inline** bottom panel — a drag-to-resize tray you place at the bottom of your own layout, *not* a route. Unlike `presentation: 'sheet'` (a full-screen modal overlay whose backdrop dims and blocks the screen behind it), a `<BottomSheet>` has no scrim: the content above it stays live and tappable, so it can host a chat composer's input + emoji panel as one unit.

It grows without a layout reflow: the panel is a fixed `maxHeight`-tall container anchored at the bottom, slid down by a `translateY` transform (main-thread-safe every frame, unlike `height`) so only the bottom `reveal` px show. Put the part that should stay pinned to the visible top (a text input) *first* in the content; it rides up as the sheet grows.

```tsx
<BottomSheet
  maxHeight={fullPx}
  detents={[inputPx, compactPx, fullPx]}   // visible heights, ascending; [0] = collapsed floor
  open={emojiOpen}                          // animate between floor and openDetentIndex
  liftSV={keyboardLiftSV}                   // ride above the keyboard: reveal = max(reveal, floor + lift)
  onReveal={(sv) => (revealSV = sv)}        // the live height SV — bind siblings to it
  onSnap={(i) => { if (i === 0) collapse(); }}
  slots={{
    handle: () => <ComposerRow />,          // the drag surface (a pill / the input row)
    default: () => <EmojiPicker />,          // body — a raw <list> here still scrolls
  }}
/>
```

The pan attaches to the `handle` slot only, so a virtualized `<list>` in the body scrolls normally (surface-drag over list content is the same arbitration gap the route sheet documents). Dragging the handle moves `reveal` 1:1 with the finger (via #681's auto-flush) and snaps to the nearest detent on release. `liftSV` + `onReveal` compose with `@sigx/lynx-motion`'s `useDerivedValue([…], 'max')` so the sheet and a sibling both track *whichever of the keyboard or the sheet is taller*, dip-free.

## License

MIT
