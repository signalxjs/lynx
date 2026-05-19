# Lynx Field Journal — `examples/showcase`

A travel journal built with **SignalX Lynx**, used as the canonical
example app for the framework. It runs natively on iOS and Android
and is intentionally small enough to read top-to-bottom in one sitting
while still touching every major piece of the stack:

- **Navigation** — typed routes, per-tab nested stacks, modal screens
- **UI kit** — daisyui-flavored components with theme switching
- **Reactive state** — signal-backed store, deep `watch`, JSON-persisted
- **Native modules** — storage, image picker, location, share, haptics
- **Safe-area chrome** — header below notch, tab bar above home indicator

If you want to see how the framework's pieces fit together in a real
app, **read the source files in order**. Each module is small and
self-contained.

## What's in the app

A field-journal flow:

1. **Trips tab** — list of trips ("Lisbon, May 2026", etc). Tap → detail.
   Header `+` opens a modal to create a new trip.
2. **Trip detail** — entries for that trip. Header **Share** exports a
   formatted summary via the native share sheet. Header `+` opens a
   modal to add a new entry. Each entry can hold a note, a photo
   (image picker), and GPS coords (location). Ghost **Delete** removes
   an entry with a warning haptic.
3. **Map tab** — every geotagged entry across all trips, sorted by
   recency, with its coords as a badge.
4. **Settings tab** — light/dark theme toggle, **Clear all data**
   button with confirm modal, version row.

All state persists between launches via `@sigx/lynx-storage`.

## Running it

Prerequisites:

- Node 18+, pnpm 9+
- macOS with Xcode (for iOS) or Android Studio + an emulator (for Android)
- This repo cloned, with `pnpm install` run at the root

```bash
cd examples/showcase
pnpm install
pnpm exec sigx run:ios        # build native + install + launch on booted sim
# or
pnpm exec sigx run:android
```

The first iOS build takes ~5 minutes (Xcode warms its caches). Subsequent
rebuilds are seconds.

For JS-only iteration (no native module changes):

```bash
pnpm dev                       # rspeedy dev server with HMR
```

If you change anything in `signalx.config.ts` (modules list, app id,
permissions), run `pnpm prebuild` to regenerate the native project, then
relaunch.

## File map

```
src/
├── App.tsx                # provider chain: safe-area → theme → navigation
├── main.tsx               # daisyui styles import + bootstrap
├── styles.css             # tailwind directives
├── routes.ts              # defineRoutes(...) + Register type augmentation
├── store/
│   ├── types.ts           # Trip, Entry, Coords
│   └── trips.ts           # signal store + watch-based persistence
└── screens/
    ├── RootTabs.tsx       # Tabs + per-tab nested Stack
    ├── TripsList.tsx      # tripsHome route
    ├── TripDetail.tsx     # tripDetail route — Share + delete + add entry
    ├── NewTrip.tsx        # newTrip modal route
    ├── NewEntry.tsx       # newEntry modal route (photo + GPS)
    ├── Map.tsx            # mapHome route — flat list of geotagged entries
    └── Settings.tsx       # settingsHome route — theme + clear + version
```

## Frameworks used

| Package | What it provides |
|---|---|
| `@sigx/lynx` | Core runtime (component, signal, watch) |
| `@sigx/lynx-navigation` | Typed routes, `<Stack>` (default slot for chrome), `<Tabs>`, modal presentation, `useScreenChrome()` |
| `@sigx/lynx-daisyui` | UI primitives + themed `<NavHeader />` and `<NavTabBar />` |
| `@sigx/lynx-safe-area` | `<SafeAreaProvider>` / `<SafeAreaView>` |

## Native modules used

| Module | Where it's used |
|---|---|
| `@sigx/lynx-storage` | `src/store/trips.ts` — persist all state |
| `@sigx/lynx-image-picker` | `src/screens/NewEntry.tsx` — attach photo |
| `@sigx/lynx-location` | `src/screens/NewEntry.tsx` — geotag entries |
| `@sigx/lynx-haptics` | save, delete, share, theme-toggle feedback |
| `@sigx/lynx-share` | `src/screens/TripDetail.tsx` — share trip summary |

Camera capture, notifications, file-system, websocket and clipboard are
**intentionally not used** — the focus is one coherent product flow, not
a kitchen-sink demo.

## Things worth knowing if you're studying this code

- **Reactive store pattern.** `src/store/trips.ts` shows the recommended
  Lynx persistence loop: signal-backed proxy + `watch(..., { deep: true })`
  → `Storage.setItem` on every mutation, gated by a `hydrated` flag so
  the watcher doesn't overwrite the snapshot mid-load.

- **Tabs + nested stacks.** `src/screens/RootTabs.tsx` is the canonical
  shape: each `<Tabs.Screen>` owns its own `<Stack initialRoute=…>`, so
  pushing inside a tab stays inside that tab. Modal routes
  (`presentation: 'modal'` in `routes.ts`) escalate to the root and
  overlay the tabs.

- **Themed tab bar.** `<NavTabBar />` from `@sigx/lynx-daisyui` reads
  `useTabs()` internally — drop it inside `<Tabs>` and it just works.
  No `class` strings, no `renderTab` boilerplate.

- **Theme switching.** `<ThemeProvider>` and `useTheme()` come from
  `@sigx/lynx-daisyui`. The provider wraps children in
  `<view class={themeName}>` so the scoped CSS variables in
  `.daisy-light` / `.daisy-dark` inherit downstream. The Settings tab
  calls `useTheme().toggle()` to flip between them.

## License

Same as the parent repo — see `LICENSE` at the workspace root.
