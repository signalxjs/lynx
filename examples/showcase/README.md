# SignalX Lynx Showcase — `examples/showcase`

The canonical example app for **SignalX Lynx**: a searchable catalog of
small, focused demos — one per framework capability. It runs natively on
iOS and Android and each demo screen is intentionally small enough to read
in one sitting.

- **Navigation** — typed routes, a single root stack, parametric sub views,
  modal presentation
- **UI kit** — daisyui-flavored components with theme switching
- **Native modules** — maps, media, location, share, webview, biometric,
  notifications, background tasks, storage, haptics
- **Safe-area chrome** — persistent header below the notch

If you want to see how the framework's pieces fit together, **read in this
order**: `src/catalog.ts` (the data model), `src/routes.ts` (the route
table), `src/screens/Home.tsx` (search + area list), then any demo screen
that interests you. Each is self-contained.

## What's in the app

A catalog flow:

1. **Home** — a search input over a grouped list of areas. Typing filters
   a flat list across every example; clearing restores the area list. The
   header button toggles light/dark theme.
2. **Area sub views** — tapping an area (UI & Theming, Text & Markdown,
   Input & Keyboard, Native modules) pushes a list of that area's
   examples. One generic, data-driven screen (`AreaScreen.tsx`) serves
   all areas.
3. **Example screens** — tapping an example pushes its demo screen. Most
   are card pushes; the keyboard-centric demos (`keyboard`,
   `markdownComposer`) present as modals because their keyboard-lift math
   assumes the composer bar sits on the bottom inset.

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

**Maps demo (Android):** `@sigx/lynx-maps` uses the Google Maps SDK, which
needs an API key. Export one before building so prebuild injects it:

```bash
GOOGLE_MAPS_API_KEY=AIza… pnpm exec sigx run:android
```

Without it the app still runs — the map just renders blank (no crash). See
[`@sigx/lynx-maps` README](../../packages/lynx-maps/README.md#android-api-key-setup).
iOS uses Apple Maps and needs no key.

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
├── App.tsx                 # provider chain + root Stack with persistent NavHeader
├── main.tsx                # daisyui styles import + bootstrap
├── styles.css              # tailwind directives
├── catalog.ts              # areas → examples data model + search filter
├── routes.ts               # defineRoutes(...) + Register type augmentation
├── themes.ts               # runtime custom theme registration (acme pair)
├── components/
│   ├── VoiceNoteRecorder.tsx  # @sigx/lynx-audio record/meter/play
│   └── VideoClipPlayer.tsx    # @sigx/lynx-video playback
└── screens/
    ├── Home.tsx            # root route — search + area list
    ├── AreaScreen.tsx      # area route — generic example list per area
    │   # UI & Theming
    ├── Appearance.tsx      # theme picker, dark toggle, follow-system
    ├── Theming.tsx         # per-screen theme + nested ThemeProvider scope
    ├── Typography.tsx      # text ramp + live font-scale control
    ├── Icons.tsx           # FA/Lucide adapters, themed + dynamic names
    ├── SystemBars.tsx      # raw status/navigation-bar styling APIs
    ├── Forms.tsx           # Input/Textarea/Select/Checkbox/Radio/Toggle
    │   # Text & Markdown
    ├── Markdown.tsx        # GFM renderer + token streaming
    ├── MarkdownEditor.tsx  # WYSIWYG editor + plugins + round-trip preview
    ├── MarkdownComposer.tsx# chat-style composer (modal)
    ├── TextApis.tsx        # selectable text + useElementLayout
    │   # Input & Keyboard
    ├── Keyboard.tsx        # KeyboardAvoidingView + KeyboardStickyView (modal)
    │   # Native modules
    ├── MapsDemo.tsx        # MapView + markers + selection card
    ├── MediaDemo.tsx       # image picker + voice note + video clip
    ├── LocationDemo.tsx    # permission + one-shot GPS fix
    ├── ShareDemo.tsx       # native share sheet
    ├── WebViewDemo.tsx     # embedded browser + imperative methods
    ├── AuthDemo.tsx        # biometric + secure storage unlock flow
    ├── NotificationsDemo.tsx # push registration + local scheduling
    ├── BackgroundTasks.tsx # BGTaskScheduler / WorkManager
    ├── StorageDemo.tsx     # key/value round-trip + clear-all confirm
    └── HapticsDemo.tsx     # impact / notification / selection
```

## Frameworks used

| Package | What it provides |
|---|---|
| `@sigx/lynx` | Core runtime (component, signal, watch) |
| `@sigx/lynx-navigation` | Typed routes, `<Stack>` (default slot for chrome), modal presentation, `useScreenChrome()` |
| `@sigx/lynx-daisyui` | UI primitives + themed `<NavHeader />` |
| `@sigx/lynx-safe-area` | `<SafeAreaProvider>` / `<SafeAreaView>` |

## Things worth knowing if you're studying this code

- **The catalog drives everything.** `src/catalog.ts` is the single source
  of truth: Home's area list, each `AreaScreen`, and search all read it.
  An example's `route` field is typed `RoutesWithoutParams`, so a route
  that was renamed or never registered fails `pnpm typecheck`.

- **Single root stack.** `App.tsx` mounts one `<Stack>` with one
  persistent `<NavHeader />` above the screen-transition wrapper. The bar
  stays in place during push/pop slides while its contents (title, back
  button, right items) update to the destination screen's chrome.
  Modal routes render their own header inside the sheet instead.

- **Icon scanning.** `@sigx/lynx-plugin` subsets icon fonts at build time
  by scanning for literal `<LucideIcon name="…">` and
  `{ set: '…', name: '…' }` IconSpec call sites. The catalog keeps its
  icons as object literals for exactly this reason; truly dynamic names
  (Home's sun/moon theme toggle) are covered by `include:` in
  `signalx.config.ts`.

- **Theme switching.** `<ThemeProvider>` and `useTheme()` come from
  `@sigx/lynx-daisyui`. The provider wraps children in
  `<view class={themeName}>` so the scoped CSS variables in
  `.daisy-light` / `.daisy-dark` inherit downstream. Home's header button
  calls `useTheme().toggle()`; the Appearance demo shows the full picker.

## License

Same as the parent repo — see `LICENSE` at the workspace root.
