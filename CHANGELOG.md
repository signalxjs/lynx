# Changelog

All notable changes to this repository are documented here. All `@sigx/lynx-*` packages share a single lockstep version — one entry per release covers every package.

## [Unreleased]

### Added

- `@sigx/lynx-datetime-picker` — **`formatDate(date, pattern)`**, a locale-free token formatter for displaying a picked date. The Lynx runtime ships no `Intl`, so every consumer was hand-rolling the same `pad()` + template literal (the showcase demo included); `formatDate(r.value, 'YYYY-MM-DD HH:mm')` replaces it. Tokens `YYYY`/`YY`, `MM`/`M`, `DD`/`D`, `HH`/`H`, `hh`/`h`, `mm`/`m`, `ss`/`s`, `A`/`a` in local time, `[bracketed]` literals pass through unsubstituted, and a missing or Invalid `Date` returns `''` so a cancelled result needs no null check. No month/weekday names — those need locale data the runtime doesn't have (#255).

### Fixed

- `@sigx/lynx-cli` — `sigx prebuild`'s fast path now hashes the CLI's own `templates/` tree (fingerprint format `v8`). It hashed project inputs plus `cliVersion`, which covers a published CLI but not a workspace one: editing a managed template (`ContentView.swift`, `MainActivity.kt`, `SigxProductionResources.*`, …) left the fingerprint unchanged, so `refresh{Ios,Android}ManagedFiles` never ran and the previous run's stale template was what landed in the built app — silently, with the only workaround being to delete `node_modules/.cache/@sigx/lynx-cli/prebuild-inputs.hash` by hand. Contributor dev-loop only; it's a fixed ~40-file tree, so the hashing cost is noise next to a prebuild (#614).

- `@sigx/lynx-cli` / `@sigx/lynx-notifications` — linking `@sigx/lynx-notifications` no longer breaks the Android build when Firebase isn't configured. The module contributed the `com.google.gms.google-services` Gradle plugin unconditionally, and that plugin hard-requires `google-services.json` at build time, so a fresh clone (or CI, or any contributor who had never built before) died on `Execution failed for task ':app:processDebugGoogleServices'` — while `copyGoogleServicesFile` merely *warned* that remote push wouldn't initialize. A module's Gradle-plugin entry can now declare `"requires": "android.googleServicesFile"`, and prebuild applies the plugin only when that config resolves to a real file, logging when it's skipped; the notifications manifest opts in. Local notifications need no Firebase at all, and remote push degrades exactly as the warning always claimed. An unknown `requires` value is rejected loudly rather than silently dropping the plugin (#618).

## [0.18.1] - 2026-07-21

### Fixed

- `@sigx/lynx-navigation` — `<BottomSheet>` now tracks `detents` / `maxHeight` **after mount**. They were snapshotted at setup and baked into main-thread state (the `reveal` seed, both derived-value offsets, and the `minReveal`/`maxReveal`/`detents` lexicals captured by the pan worklets), so later updates did nothing — silently. That broke the component's headline use case: a composer accessory's collapsed floor is inherently variable (an attachment chip row appears above the input, the input grows from one line to several, banners come and go), and since the sheet reveals the top `reveal` px of top-aligned content, a floor that couldn't grow pushed the input row and send button out of the revealed slice and behind the keyboard. Geometry is now read live, the two derived offsets use `useDerivedValueReactive` (the derived SV identity is stable, so `onReveal` consumers stay bound), worklet geometry is pushed through a main-thread ref so the drag clamp and release-snap candidates stay current, a parked sheet follows its floor, and geometry that shrinks pulls the held `reveal` and any captured `openToLift` rest back into range (#743).

## [0.18.0] - 2026-07-21

### Added

- `@sigx/lynx-core` — **app foreground/background state** (#607): `AppState.current` / `AppState.available` / `AppState.subscribe(cb)`, plus a reactive `useAppState()` (`Computed<AppStateStatus>`). For reconnecting a socket the instant the app resumes, refreshing data that went stale while backgrounded, or pausing timers/media. Hosted in core as an ambient lifecycle primitive alongside `Platform`/`DeviceInfo` (not a standalone package): Android reuses core's existing `SigxActivityHook` (`onResume`/`onPause`) to drive an `AppStateBus` — no second activity hook; iOS adds an `AppStatePublisher` (`didBecomeActive`/`didEnterBackground`) and a `getAppState` seed on the `SigxCore` module. Driven by a single signal, so imperative subscribers and reactive consumers share the reactivity system's `watch` + `Object.is` dedup rather than a hand-rolled listener set. Core gains its first dependency, `@sigx/reactivity` (a zero-dependency leaf, so no cycle) (#609).

### Fixed

- `@sigx/lynx-list` — chat mode (`inverted` + `stickToBottom`) can no longer stay stuck at `opacity: 0`: a bounded safety-net reveals the thread even when a mount-time layout race prevents the first `layoutcomplete` from landing (the `layoutcomplete` path still wins in the common case, so there's no flash). Surfaced by the showcase WhatsApp emoji composer demo, whose layout was also fixed — chat fill / no modal bleed-through, input at the correct safe-area position, and the warm emoji picker no longer peeking below the input while collapsed (#741).

## [0.17.0] - 2026-07-19

### Changed

- `@sigx/lynx-cli` — adopt the core-0.12 line of the sigx CLI toolchain: `@sigx/cli` `^0.5.0` → `^0.6.0` and `@sigx/terminal` `^0.6.1` → `^0.8.0`. `@sigx/terminal@0.8.0` now declares its `@sigx/reactivity`/`@sigx/runtime-core` deps at `^0.12.0`, so the transitively-pulled terminal family resolves against this repo's single 0.12.0 core copy natively — the CLI-only build stray (an old `@sigx/reactivity@0.4.9` reaching in via `@sigx/cli@0.5.0` → `@sigx/terminal@0.5.0`) is gone from the runtime path. With that, the `peerDependencyRules.allowedVersions` override in `pnpm-workspace.yaml` (widened to `>=0.12.0 <0.13.0` for the `@sigx/terminal*`/`@sigx/runtime-terminal` families in #720 as a workaround for terminal 0.6.1 not declaring a 0.12 core peer) is no longer needed and is removed; strict installs stay clean with no unmet-peer warnings for the terminal family. Dep bump + override cleanup only — no lynx source change (#727).

## [0.16.0] - 2026-07-18

### Added

- `@sigx/lynx-notifications` — **local** notifications work on web (#718 Tier 2): `schedule`/`cancel`/`cancelAll` via the `@sigx/lynx-web-host` bridge to the browser Notification API (delay + repeat as page-lifetime timers; cancel closes shown entries), permission methods with browser-denial → `blocked`, badges via the Badging API best-effort with a locally-tracked count. Remote push degrades cleanly: `registerForPushNotifications()` resolves `{ error }`, listeners never fire, `getInitialNotification()` resolves `null` (#723).

- `@sigx/lynx-location` works on web (first Tier-2 shim, #718): `getCurrentPosition` routes through the `@sigx/lynx-web-host` bridge to `navigator.geolocation` (`accuracy: 'high'` → `enableHighAccuracy`, `timeout` passthrough, coords mapped with null-normalized altitude/speed/heading); permission methods map the Permissions API (browser denial → `blocked`/`canAskAgain: false`; `requestPermission` surfaces the prompt via a position request). Requires a secure context (#721).

- Root README documents the web story: the gesture system (all six recognizers + Race/Simultaneous/Exclusive composition, same-element arena semantics), animations, navigation, appearance, deep links and 9+ shimmed native modules in the browser, with `sigx run:web` (zero config) and `sigx build:web` (static export). A hosted public demo was deliberately deferred — a GitHub Pages project site for this repo would shadow the docs site's `sigx.dev/lynx/` path (#716).

- `@sigx/lynx-cli` — **`sigx build:web`**: deployable static export of the web app to `dist/web/` (host page, `@lynx-js/web-core` engine, app bundle + async chunks, `@sigx/lynx-web-host` bridge, plus `_headers`/`vercel.json` COOP/COEP samples). Flags: `--out`, `--base` (subpath hosting), `--coi` (vendored cross-origin-isolation service worker for header-less hosts like GitHub Pages — one automatic first-visit reload). The one-shot build waits for the rspeedy child to exit before assembling, so a stale bundle can never be exported mid-clean; `hostHtml` is now shared between `run:web` and the export (reload/base/coi options) (#714).

- `@sigx/lynx-runtime-main` — the page root gets the native-equivalent layout context on web: `renderPage`/`sigxHotReload` set `display: flex; flex-direction: column` directly on the page DOM node (web-core maps `flex-direction` through `__SetInlineStyles` onto a custom property only `x-*` elements consume, so the real property is written instead — browser-verified). Fixes `flex: 1` app roots collapsing to 0-height on web; `__WEB__`-gated, native bundles unchanged (#709).

- Web implementations for six more native modules on the #703 host bridge (web bundle swaps them in via #697; native unchanged): **`@sigx/lynx-clipboard`** (`navigator.clipboard`; read denial → `''`/`false`), **`@sigx/lynx-linking`** (`openURL`/`canOpenURL` via `window.open` + scheme allowlist; inbound `getInitialURL`/`addEventListener` work unchanged through the host publisher — inbound logic extracted to a shared `inbound.ts` used by both platforms), **`@sigx/lynx-share`** (`navigator.share`; call from a tap handler so the user gesture survives the RPC), **`@sigx/lynx-image-picker`** + **`@sigx/lynx-file-picker`** (browser file dialog → `blob:` URLs with metadata and image dimensions; permissions resolve granted), and **`@sigx/lynx-haptics`** (best-effort `navigator.vibrate` patterns — still never-throw, `isAvailable()` stays `false` as a degraded approximation). Each README gains a "Web" section (#706).

- **New package `@sigx/lynx-web-host`** — the host-page side of SignalX web support: handles the worker's `sigx.*` RPC calls (clipboard, linking open/canOpen, share, file picker with image dimensions, vibrate) against real browser APIs, and publishes page state into the card — `globalProps.appearance` + live `appearanceChanged` events from `prefers-color-scheme` (so `@sigx/lynx-appearance` works on web with **no** shim) and `globalProps.initialURL` + `urlReceived` on popstate/hashchange (consumed by `@sigx/lynx-linking` unchanged). `dist/host.js` is a self-contained ESM file; `sigx run:web` serves and installs it automatically. `@sigx/lynx-core` gains the worker-side caller: `webHostCall<T>(name, data)` (protocol `sigx.<module>.<method>`, `{ok, value}|{ok:false, error}` responses) + `isWebHostAvailable()` — the primitive the upcoming host-bridge `.web.ts` shims build on (#703).

- Web implementations for three native modules (first Tier-1 shims on the #697 `.web.ts` mechanism — the web bundle swaps them in automatically; native bundles are unchanged): **`@sigx/lynx-storage`** is backed by IndexedDB with a write-through in-memory mirror preserving the sync-void `setItem`/`removeItem`/`clear` shape (read-after-write consistent; writes flush in call order); **`@sigx/lynx-websocket`** re-exports the Worker-global WHATWG `WebSocket` (the native base64/demux bridge tree-shakes out of the web bundle); **`@sigx/lynx-network`** reports `navigator.onLine` + `navigator.connection.type`. Each package README gains a "Web" section (#701).

- `@sigx/lynx-plugin` + `@sigx/lynx-cli` — `sigx run:web` no longer requires an `environments` block in `lynx.config.ts`: the CLI sets `SIGX_WEB_ENV=1` for the rspeedy child and the plugin auto-provides `environments.lynx` + `environments.web`, merging only missing keys (user-declared environments and their contents are never touched). Plain `sigx dev` / `sigx build` / direct `rspeedy build` are unchanged — no env var, no injection. Opt out with the new `pluginSigxLynx({ web: false })` option (#699).

- `@sigx/lynx-plugin` — on the web environment, `resolve.extensionAlias` now maps `.js → ['.web.js', …]` (and `.jsx` likewise), merged ahead of rsbuild's tsconfig-driven aliases. This makes per-package `*.web.ts` files work for **published dists** too: a package can ship `storage.ts` (native bridge) + `storage.web.ts` (browser implementation) and the web bundle picks the `.web` variant even through the dist's explicit `./storage.js` imports, while the native bundle tree-shakes it out entirely. Foundation for the native-module web shims (#697).

- `@sigx/lynx-runtime-main` — arena relations work on web: `waitFor` and `simultaneous` (what `Gesture.Race`/`Exclusive`/`Simultaneous` compile to) now gate gesture activation in the web recognizer. Per press each gesture is possible → active | failed; only `onStart` is gated (`onBegin`/`onEnd` always fire, so `Pressable`'s LongPress.onEnd visual reset keeps working); activating a gesture fails related non-simultaneous rivals; `Race`'s mutual waitFor resolves as first-ready-wins; a Fling not recognized within ~300ms fails, letting `Exclusive(Fling, Pan)` hand over to the pan mid-drag. Unrelated gestures keep co-firing exactly as before (no relations → no behavior change). `continueWith` has no consumers and is logged-and-ignored (#695).

### Changed

- `@sigx/lynx`, `@sigx/lynx-runtime`, `@sigx/lynx-runtime-main`, `@sigx/lynx-appearance`, `@sigx/lynx-safe-area`, `@sigx/lynx-testing` — adopt **sigx core 0.12.0**: the `catalog:` pin for `@sigx/reactivity` and `@sigx/runtime-core` moves `^0.10.0` → `^0.12.0` (a one-line bump in `pnpm-workspace.yaml`; every package already consumes core via `catalog:`). No lynx source change: the 0.10 namespace-agnostic-runtime-core rework only adds *optional* `RendererOptions` host ops (`getElementNamespace`/`getChildNamespace`/`getContainerNamespace`) — lynx's dual-thread renderer has no element namespaces and doesn't implement them — and the 0.11 `isSVG`→`ns` renderer-hook rename is positional, which lynx's `createElement`/`patchProp` ignore; 0.11/0.12 are otherwise additive (coded prod errors, `@sigx/server`, the vite adapter — none consumed here). Build, typecheck and the full test suite pass against 0.12.0. Published manifests rewrite `catalog:` to `^0.12.0` at pack time, as before (#720).
- The `peerDependencyRules.allowedVersions` override for the CLI-only `@sigx/terminal*` family (pulled in transitively by `@sigx/lynx-cli`) widens `>=0.10.0 <0.11.0` → `>=0.12.0 <0.13.0`. No 0.12-compatible `@sigx/terminal` exists yet — its latest `0.7.0` moved core from peer- to regular-dependencies pinned at 0.10.x, which would install a second physical `@sigx/reactivity` copy — so we stay on the peer-based `@sigx/terminal@^0.6.1` and keep it resolving against this repo's single 0.12.x copy (#720).
- `@sigx/lynx-runtime-main` — web gesture `touch-action` is now derived axis-aware from ALL gestures on the element instead of blanket `none`: Pan `axis:'x'` (Swipeable, Range) → `pan-y` so vertical page scrolling keeps working through horizontal swipe surfaces (a browser-claimed vertical swipe `pointercancel`s the press — graceful handoff); Pan `axis:'y'` (sheet drag) → `pan-x`; free Pan/directionless Fling/Pinch/Rotation → `none` as before; horizontal Fling → `pan-y`, vertical → `pan-x`; conflicting wants collapse to `none`; Tap/LongPress-only elements stay untouched. Recomputed on every gesture register/unregister with the original value restored when nothing needs an override (#693).

### Added

- `@sigx/lynx-runtime-main` — `Gesture.Pinch()` and `Gesture.Rotation()` are recognized on web (two-finger): the first two concurrent pointers pair up — `onStart` when the second lands, `onUpdate` on either's move, one dedicated `onEnd` with final values when either lifts. Payloads follow the legacy `usePinch`/`useRotation` semantics: pinch `params.scale` = currentDistance/baseDistance; rotation `params.rotation` = cumulative signed radians (properly unwrapped across ±π, unlike the hooks) plus `params.velocity` (rad/ms); both carry `focalX/focalY` (page-coordinate midpoint, mirrored into pageX/pageY). Pinch/Rotation elements get `touch-action: none` so the browser doesn't claim two-finger contact for page zoom. Since the native arena handlers are unfinished (#418), this payload is the contract native should converge on. The showcase PinchRotateDemo gains an arena-driven pad next to the legacy-hook pad (#690).

- `@sigx/lynx-runtime-main` — `Gesture.Fling()` is recognized on web: at the primary pointer's release, velocity over a trailing ~100ms sample window is matched against the gesture's `direction` and `minVelocity` (px/ms, default 0.3 ≈ 300 px/s); a match fires `onStart` with `params.velocityX/velocityY` before the universal `onEnd`. Fling elements get a `touch-action` override like Pan so the browser doesn't claim the swipe (axis-aware since #693 — see the Changed entry above). The `FlingBuilder.minVelocity` JSDoc now documents the px/ms unit (#687).

### Fixed

- `@sigx/lynx-runtime-main` — web gesture recognizer now tracks pointers per `pointerId` instead of one flat press state, so a second finger no longer clobbers an active press: the press stays driven by the primary pointer, a secondary contact disqualifies Tap and cancels pending LongPress timers (matching native recognizers failing on a second touch), and a secondary lift no longer ends the press. Foundation for two-finger Pinch/Rotation on web (#685).

## [0.15.0] - 2026-07-16

Conversation-grade notifications (stacking + remote dismissal) and the WhatsApp-class emoji picker (sectioned, instant-mount, screen-adaptive).

### Added

- `@sigx/lynx-emoji` — WhatsApp-style sectioned picker: ONE continuous scroll over every category with sticky full-span section headers. Tab tap scrolls (a main-thread worklet drives `scrollToPosition` — the mounted row set never changes); the active tab follows the scroll via exact per-section offset math; recents are the first section, snapshotted per mount (empty recents hide the tab). New `recentsLabel` prop and `classes.sectionHeader` theming; `SectionHeader` poolable template; `EmojiCell` gains an `itemKey` override. Search keeps the flat filtered grid (#663).
- `@sigx/lynx-list` — `sticky`/`stickyOffset` props pass through to the native `<list>`; `SCROLL_METHOD` exported; JSX gains `sticky` on `<list>` and boolean `sticky-top`/`sticky-bottom` on `<list-item>` (#663).
- `@sigx/lynx-emoji` — new public surface from the instant-mount work: `EmojiGridScrollHandle`/`scrollHandle` (staged-aware scroll-to-section), `createStagingDriver` (budget-adaptive cooperative staging, reusable for warm pre-staging), context `ready` signal, stores' `loaded` (#667).
- `@sigx/lynx-notifications` — Android conversation-style stacking for data-only pushes. Sending `data.style: "messaging"` renders the tray entry with `MessagingStyle` and **accumulates**: each push under the same `data.notification_id` appends a line (sender + message, last 7 kept) instead of replacing the body, so earlier messages stay visible — WhatsApp-style chat notifications. New optional keys: `data.sender_name`/`senderName` (line attribution, falls back to `title`), `data.conversation_title`/`conversationTitle` (header, carried over when omitted), and `data.group` (bundles conversations under one expandable tray group with an auto-posted summary; `cancel(group)` dismisses the summary). History lives in the tray itself (extracted from the active notification on each post), so it survives process death without storage. Plain pushes keep today's replace-in-place; below API 23 stacking falls back to replace-in-place. Tap contract unchanged: payload = latest push's `data`. iOS is untouched — `aps.thread-id` already stacks natively. Re-run `sigx prebuild` to pick up the native change (#660).

### Changed

- `@sigx/lynx-notifications` — `cancel(id)` now dismisses delivered **remote** pushes whose `data.notification_id` matches the id, on both platforms. This was previously incidental on Android (same `hashCode` keying, now a documented contract) and impossible on iOS (delivered remote entries carry a system-assigned request identifier; `cancel` now also matches on the payload id). Gives apps a cross-platform "clear this notification from JS" — e.g. dismissing a conversation's tray entry when it's read on another device. Also fixed on iOS: notification tap responses now report the payload's `notification_id` (falling back to the request identifier for local schedules) instead of the system-assigned identifier, so the tap contract from #619 holds for remote pushes. `cancel()`/`cancelAll()` are now typed `Promise<boolean>` (what the native side always resolved) instead of `Promise<void>`, and `cancel()` resolves `false` for a null/empty id (previously Android hashed `''` and cancelled notification id 0). Re-run `sigx prebuild` to pick up the native changes (#659).
- `@sigx/lynx-emoji` — picker mount is instant and cooperative: tap→first-paint drops ~4.3s → ~0.8–0.9s (emulator) and no thread blocks past ~a frame while ~1,900 rows stage. Sectioned rows render via plain-row templates instead of per-row component instances; the grid mounts once, gated on stores hydrated + region measured (also fixes cold-start recents rendering empty); the remainder stages in ~14ms budget slices; a far tab tap mid-staging parks and lands without a second tap (#667).
- `@sigx/lynx-emoji` — screen-adaptive glyph sizing: the default `cellSize` derives from the measured grid width (`width / columns × 0.78`, clamped 28–44) instead of a fixed 32px, so the picker no longer renders undersized on dense/large screens. Explicit `cellSize` still wins; the skin-tone popover follows the resolved size (new optional `size` prop); tab glyphs and header labels bumped to match; search results share the resolved size (#670).

### Fixed

- `scripts/build-snapshot-dist.mjs` (templated package dists, e.g. `@sigx/lynx-emoji`) — `runOnMainThread` and MT event worklets inside a packaged dist were structurally dead: the dist emitter stripped `'main thread'` bodies into placeholders but never emitted their registrations, so the MT registry lookup returned undefined (`cannot read property 'bind' of undefined`). The emitter now appends guarded `registerWorkletInternal` registrations for every worklet id a dist references, with a build-failing completeness invariant (#665).

## [0.14.0] - 2026-07-16

### Changed (breaking)

- `@sigx/lynx`, `@sigx/lynx-runtime`, `@sigx/lynx-appearance`, `@sigx/lynx-safe-area`, `@sigx/lynx-testing` — adopt **sigx core 0.10.0**: `@sigx/reactivity` and `@sigx/runtime-core` bumped `^0.7.0` → `^0.10.0`, skipping three minors. This is how core's renderer work reaches Lynx: `@sigx/lynx-runtime`'s renderer *is* runtime-core's `createRenderer`, and core 0.8.0 was a heavy perf release for exactly that code — an LIS-based keyed diff, a single-child reconciliation fast path, fewer per-vnode allocations in `jsx()`, plus reactivity proxy-trap and dependency-link reuse. `@sigx/reactivity` has no public API change across 0.7.0 → 0.10.0 (pure perf); `@sigx/runtime-core` drops four exports, which the `@sigx/lynx` umbrella re-exports and therefore no longer provides (#647):
  - **`Suspense` → `Defer`.** Core 0.9.0's value-first async rework retires `Suspense` in favour of `<Defer fallback>`, whose fallback covers lazy *chunk* loading. Apps wrapping a `lazy()` route or component in `<Suspense>` should rename it to `<Defer>`; the props are the same shape. `lazy()` / `isLazyComponent()` are unchanged.
  - **`ErrorBoundary` → `errorScope`.** Replaced by the `errorScope` seam from the same rework.
  - **`useAsync` → `useData` / `useAction`.** Superseded by the value-first pair, read through `match`.
  - **`SuspenseProps` → `DeferProps`.**
- `@sigx/lynx-navigation` — lazy routes now mount their `fallback` inside a `<Defer>` boundary instead of `<Suspense>` (#647). No API change: `RouteDefinition.fallback` keeps its shape and meaning, and eager routes are unaffected. Callers placing their own boundary above `<NavigationRoot>` (the documented alternative to a per-route `fallback`) must rename it to `<Defer>`.

### Fixed

- `@sigx/lynx-runtime` — `useData` / `useAction` now run on Lynx. Core gates its async fetchers on `isLiveClient()`, whose fallback is `typeof window !== 'undefined'` — false on the Lynx BG thread — so without an explicit declaration core treated every Lynx app as a *server render* and never ran a fetcher: the cell sat at `pending` forever, silently. The runtime now calls core's `declareLiveClient()` on import (the seam core added for exactly this, naming Lynx as a target), before any component setup can read a cell. Verified on device: a `useData` read goes from `pending` (hung) to `ready` with the fetched value (#647).

### Changed

- The sigx core versions are now declared once, as a pnpm **`catalog:`** in `pnpm-workspace.yaml`, instead of an `^x.y.z` range hand-copied into each package. Future core bumps are a one-line change rather than a ten-range sweep across eight manifests, which is what let `examples/showcase` drift onto a stale `@sigx/cli` unnoticed. Published manifests are unaffected — `pnpm publish` rewrites `catalog:` to the concrete range exactly as it already does for `workspace:^` (#647).

## [0.13.0] - 2026-07-15

### Added

- `@sigx/lynx-list` — new `itemsKey` prop: an identity for the dataset. When it changes, `items` is treated as a brand-new list instead of an update — the window (when windowing) re-anchors to its initial position and the scroll resets to the start (the bottom in chat mode). Use it when swapping wholesale between datasets (tabs, categories, a new search); previously such a swap left the viewport stranded wherever scrolling had left it in the old dataset. Zero-cost when omitted (#600).
- `@sigx/lynx-list` — new `initialMainAxisSize` prop: pins the native list to a known main-axis size on its very first frame instead of the 1px placeholder, killing the mount-frame flash + re-layout for consumers that already know the box (the live measure still wins once it lands) (#610).
- `@sigx/lynx-emoji` — `EmojiGrid` gains optional `itemsKey` (dataset identity, forwards to `List.itemsKey`) and `initialHeight` (forwards to `List.initialMainAxisSize`) props for headless grid users (#602, #610).

### Fixed

- `@sigx/lynx-notifications` — notification-tap payloads now survive to JS, on both platforms and for every message shape. Five defects on one path, each of which alone made tap routing look broken (#619):
  - **Tap events arrived with every scalar field stripped (both platforms).** `sendGlobalEvent` drops a payload's sibling scalars when it carries a nested map (#342 — the same Lynx 0.5.0 / PrimJS 3.8 regression `@sigx/lynx-http` documents), and *every* notification payload nests `data`. So `title`, `body`, `foreground`, `notificationId` and `actionIdentifier` all arrived `undefined` while `data` came through intact — which is exactly why the bug read as "the data is there but tap routing does nothing", and why nobody noticed the missing scalars. Both buses now JSON-encode each event and emit it as a single string, mirroring `HttpEventBus` / `WebRTCEventBus`; the JS shim already parsed string-form events. `getInitialNotification()` returns a JSON string for the same reason — it is the one callback in the module carrying a nested map, and nested-map marshalling over `Callback` / `LynxCallbackBlock` is unproven (the sole precedent, `FilePickerModule`, is masked by JS-side defaulting) — and `src/notifications.ts` parses it.
  - **Android: a tap on an OS-rendered notification lost the payload entirely.** FCM only calls `onMessageReceived` for a backgrounded/terminated app when the message is data-only; a message carrying a `notification` block is rendered by the OS, which never invokes it — so the module never built its tap intent, and `getInitialNotification()` came back empty on exactly the cold start deep-linking exists for. `PushActivityHook` now also treats a launch intent carrying `google.message_id` as a tap and harvests the sender's `data` keys back out of it, delegating the reserved-key filter to `RemoteMessage(Bundle).getData()` (the SDK's own, so Google's reserved set stays authoritative — the approach react-native-firebase and flutterfire use). Best-effort by nature: cold start is reliable, but the warm tap goes through an intent FCM builds and may not be delivered at all, so data-only remains the dependable path when tap routing matters.
  - **Android: data-only messages showed no tray entry.** `title` was read only from `message.notification`, so the one shape that *does* reach `onMessageReceived` in the background produced no notification at all — making the standard fix for the above (switch the sender to data-only) trade one failure for another. `title`/`body` now fall back to the `data` map.
  - **Android: warm taps never reached `onNewIntent`.** The tap intent was `getLaunchIntentForPackage()`'s ACTION_MAIN/CATEGORY_LAUNCHER intent; starting one against an existing task is treated as a launcher relaunch — the task is brought forward and the intent is never delivered, so the extras evaporated and `addNotificationResponseListener` never fired for a background-but-alive tap. The module now builds an explicit-component intent with `SINGLE_TOP | CLEAR_TOP`.
  - **Android: a config-change recreate re-delivered a drained tap.** The tap marker was never cleared from `activity.intent`, so a rotation or font-scale change re-ran `onCreate` and re-stashed a payload JS had already consumed, deep-linking a second time. The markers are now consumed, and `onCreate` ignores a recreate.
- `@sigx/lynx-notifications` — iOS: `getInitialNotification()` no longer reports a notification the user never tapped. iOS populates `launchOptions[.remoteNotification]` when a `content-available` push launches the app **in the background**, with no interaction; the hook stashed that as the initial tap, so the next manual open deep-linked off a silent push. The same branch also double-handled genuine taps (captured at launch *and* republished by `didReceive`). The launchOptions branch is gone — `didReceive` fires for every real tap including cold start, since the delegate is installed before `didFinishLaunching` returns, and is now the single source of truth (the approach RN Firebase and Expo rely on) (#619).
- `@sigx/lynx-notifications` — iOS: a cold-start tap is no longer stranded when JS calls `getInitialNotification()` early. The cold-start window closed on the first `consume` even when it returned nil, so a call landing in the gap between launch and `didReceive` — the normal path for a local notification launched from a terminated state — sent the tap to the response channel, where nothing was listening yet. The window is now keyed on whether the app has ever reached `.active` (a launch tap precedes activation; an in-session tap follows it) and `consume` is a pure one-shot drain (#619).
- `@sigx/lynx-notifications` — iOS: `actionIdentifier` now means the same thing on both platforms. iOS reported Apple's raw `UNNotificationDefaultActionIdentifier` (`"com.apple.UNNotificationDefaultActionIdentifier"`) for a standard tap while Android sent `"default"` — which `NotificationResponse` documents — so an app routing on `actionIdentifier === 'default'` worked on Android and silently never matched on iOS. The native side now maps Apple's default constant onto `'default'`; custom category action ids pass through untouched. Normalized natively rather than in the JS shim, so the raw event channels carry the same contract as the typed API. Apple's dismiss constant is mapped to `'dismiss'` for the same reason, though nothing emits it yet — iOS only delivers that action for a category registered with `.customDismissAction`, and Android sets no `deleteIntent` (#619).
- `@sigx/lynx-notifications` — iOS: nested APNs custom values are recoverable. Values were coerced with `"\(v)"`, which renders a nested object as Swift's *debug* description (`{ id = 42; }`) and a JSON `true` as `"1"`. Non-string values are now JSON-encoded, so `data.yourKey` round-trips via `JSON.parse` and booleans read as `"true"`. The wire type stays `Record<string, string>` — FCM's `data` map is string-only, so strings remain the cross-platform floor (#619).
- `@sigx/lynx-cli` + `@sigx/lynx-plugin` — dynamic `import()` now works in standalone/store builds (#599). Async chunks (`dist/static/js/async/<hash>.js`) previously loaded only in `sigx dev` (the dev server served them); release builds shipped without them and no fetcher, so every dynamic import rejected at runtime with the native `No available provider or fetcher` error — silently, since nothing warned at build time. Now: (1) release flows (`sigx run:* --release`, `sigx prebuild --embed-bundle`) mirror `dist/static/js/async/**` into the native projects (iOS `LynxAssets/` blue-folder reference — injected idempotently into existing pbxprojs on prebuild — and Android `assets/`); (2) the managed native shells register production resource fetchers (`SigxProductionResources.swift`/`.kt`) that map the runtime's root-relative chunk URLs onto those embedded assets, with an http(s) fallback for remotely-hosted chunks; (3) `@sigx/lynx-plugin` pins the production `output.assetPrefix` to `/` (only when unset) so chunk request URLs stay root-relative and map 1:1; (4) `sigx build` and the plugin's after-build hook surface every emitted async chunk, and `sigx updates:publish` refuses to publish while `dist/` contains async chunks (OTA payloads carry only `main.lynx.bundle`) unless `--allow-async-chunks` is passed for remotely-hosted setups. Existing apps pick everything up on the next `sigx prebuild`.
- `@sigx/lynx-list` — edge events (`scrolltoupper`/`scrolltolower`) now act **once per arrival** and only re-arm when a real scroll moves away from that edge. Native re-fires them continuously while a list is parked at an edge — measured 1,674 `scrolltoupper` dispatches with no scrolling at all and only 2 renders (~240/s, far above frame rate) — and a list whose container size is momentarily invalid reports both edges at once. Acting on every dispatch ping-ponged the window (expandNewer trims the head → the top edge re-fires → expandOlder trims the tail → repeat), spun hundreds of re-renders, and handed consumers hundreds of bogus `startReached` calls (#606).
- `@sigx/lynx-list` — the top edge is now bound only when it can do work (chat mode, a window with older items to reveal, or a real `onStartReached` listener), and `bindscroll` is throttled by default (100ms). `List` always binds `bindscroll` internally and nothing internal needs per-frame resolution; both changes cut needless native→JS dispatch (#606).
- `@sigx/lynx-emoji` — the picker no longer renders blank, and switching categories no longer trips the engine's event-dispatch limiter (error 204, red-screened by the dev overlay). Two independent causes, both measured on device:
  - **Blank:** the native list produces invalid layout — blank, or content displaced off-screen — once roughly 130-150+ cells are mounted at once. It is racy (the same count renders on one run and blanks on the next), it predates the windowed grid (release 0.12.2 mounted all 171 smileys and blanked identically), and it reproduces with no emoji code at all by raising the List showcase demo's window to ~250 (#603). The grid window is **64 cells initially / 96 at full expansion**, which renders reliably where 120+ did not.
  - **204 flood:** category grids are no longer kept mounted behind `use:show`, and exactly one grid is mounted at a time. A hidden grid has a zero-height container, so it believes it is permanently parked at its bottom edge and dispatches `scrolltolower` to JS forever — 599 dispatches over 3 tab switches with 4 kept grids, vs 8 with only the active one (#606).
- `@sigx/lynx-emoji` — switching categories no longer freezes on big categories, and tapping a tab highlights it immediately. `EmojiGrid` renders through a windowed `List` (`@sigx/lynx-list`): the sigx renderer eagerly builds every rendered `<list-item>` subtree (the native recycler only virtualizes views for scrolling), so a switch to people-body previously tore down and rebuilt ~388 cell subtrees in one pass. Switches are two-phase — the tab highlight paints in its own cheap flush, the grid swap follows a tick later — and the grid lays out at full height on its first frame instead of flashing a 1px placeholder (#602, #610).
- `@sigx/lynx-emoji` — the picker no longer renders a fully blank screen on device. `createEmojiContext` now snapshots the dataset to plain objects once (it is static by contract and JSON-born, so the round-trip is lossless): grid items and search entries read proxy-free, dropping deep-proxy read overhead over ~1900 entries (#602).


- `@sigx/lynx-updates` — Android: a purely numeric `updates.runtimeVersion` pin (e.g. `'2'`) made every `checkForUpdate()` report `incompatible`: aapt stores numeric-looking `<meta-data android:value>`s as typed (non-String) values, and the native reader used `Bundle.getString()`, which logs a `ClassCastException` warning and returns null for them — the binary's runtime version read back as `"unknown"`. The reader is now type-tolerant (`get(...)?.toString()`), and `@sigx/lynx-cli` prebuild warns when a pinned runtimeVersion would be re-typed by aapt (already-shipped binaries keep the old reader, and non-canonical forms like `0x1A` or `1e3` still can't round-trip). iOS was unaffected. Note: the fix changes `@sigx/lynx-updates`' Android source content, so auto-computed runtime fingerprints change on next prebuild (#598).

## [0.12.1] - 2026-07-13

### Changed

- `@sigx/lynx-cli` — adopted `@sigx/cli` 0.5.0's typed plugin args (#589): the dependency moves `^0.4.2` → `^0.5.0` and all ~30 `ctx.args.<flag> as boolean` / `as string | undefined` casts in `plugin.ts` are gone — `ctx.args` now infers its exact types from the `a` builders inside `definePlugin`. No behavior change; `sigx-cli.requires` stays `>=0.4.0` since no new runtime contract features are used.

## [0.12.0] - 2026-07-13

_Backfilled — the 0.12.0 release PR (#586) shipped without rolling this file._

### Added

- `@sigx/lynx-list` — new data-driven virtualized list: feed mode, chat mode (bottom-anchored + stick-to-bottom), pull-to-refresh + infinite load-more, windowing / load-older for large histories (#548, #550, #552, #554).
- `@sigx/lynx-cli` — FCM google-services plugin/json + iOS aps-environment wired for remote push (#565).

### Fixed

- `@sigx/lynx-list` — clipping/scroll/prepend fixes (#562, #564, #567).

## [0.11.0] - 2026-06-24

### Added

- `@sigx/lynx-camera` — **video recording**: `Camera.recordVideo(options?: CameraVideoOptions): Promise<VideoResult | CameraCancelled>` opens the system camera in video mode and returns the recorded clip's URI (`file://` on iOS, `content://` on Android), loadable directly by `@sigx/lynx-video`. iOS uses `UIImagePickerController` movie mode (honoring `maxDurationMs` via `videoMaximumDuration` and `facing` via `cameraDevice`); Android uses an `ACTION_VIDEO_CAPTURE` launcher wired through `@sigx/lynx-permissions`' `MediaCapture`. New exports: `CameraVideoOptions`, `VideoResult`, and `CameraCancelled`. Both `takePicture` and `recordVideo` now follow a three-outcome contract — resolve with a result (always carrying a `uri`), resolve with `{ cancelled: true }` (no `uri`) on user-cancel, or **throw** on failure (permission denied, no camera, …) — so callers narrow on `result.uri` and `try/catch` failures (the Android `{ error: "cancelled" }` cancel sentinel is normalized away). The cross-platform "photo or video" choice is an app-level chooser (see the showcase's `MediaCaptureCard`); a single in-camera toggle is iOS-only at the system level (#541).
- `examples/showcase` — the **Media** screen gains a WhatsApp-style "Capture or pick" card (`MediaCaptureCard`) whose one button fans out to Take Photo, Record Video, Pick Photo, and Pick Video — surfacing camera capture and the already-existing `ImagePicker.pickVideo` library video picker (#541).
- `@sigx/lynx-dev-client` / `@sigx/lynx-plugin` — **device runtime exceptions now stream to the `sigx dev` terminal.** The native red-screen error sink (Android `LynxViewClient.onReceivedError`, iOS `didRecieveError`) — a *superset* of the JS `lynx.onError` hook that also catches main-thread-script, template, render and native-module errors — is POSTed to a new `/__sigx/device-error` endpoint on the dev log server (dev port + 1) and printed as a `📱 <platform> … ERR …` line, so anything on the on-device red screen is also copyable in the terminal's Logs tab. Errors that also travel the existing JS console path are de-duplicated server-side within a short window, so each error shows up once (#540).

### Fixed

- `@sigx/lynx-camera` — Android: `takePicture` / `recordVideo` now request the `CAMERA` runtime permission before launching the system-camera intent. Because the autolinker declares `CAMERA` in the manifest, Android **requires it granted** before `ACTION_IMAGE_CAPTURE` / `ACTION_VIDEO_CAPTURE` will fire — without it the launch failed with *"Permission Denial … requires android.permission.CAMERA"*. `recordVideo` additionally requests microphone, but only when the app declares `RECORD_AUDIO` (e.g. `@sigx/lynx-audio` is installed), so camera-only apps aren't over-prompted. This brings Android to parity with iOS (which already auto-requests at the `AVCaptureDevice` layer), so callers no longer have to call `requestPermission()` first (#544).
- `examples/showcase` — declare the `@sigx/lynx-camera` dependency that `MediaCaptureCard` uses. It resolved via pnpm workspace hoisting so the JS bundle built, but the autolinker keys off declared dependencies, so the native `Camera` module wasn't linked and capture failed at runtime (#544).
- `@sigx/lynx-video` — Android: `<video-player>` crashed on mount (`createUI catch error … ExoPlayerImpl.addListener`, surfaced to the app as Lynx's `Insertion (new) failed due to unknown child signature`). `LynxUI`'s super constructor calls `createView()` before the subclass's property initializers run, so the `playerListener` field was still `null` when `createView` registered it on ExoPlayer (whose `addListener` rejects null). Build the listener in a function and seed the player with explicit defaults instead (#537).
- `@sigx/lynx-video` — the `onStateChange` event never reached JS handlers on either platform: `statechange` is a reserved event name in the Lynx engine, so custom `bind` handlers for it were silently dropped (sibling events `load` / `timeupdate` / `end` / `error` were unaffected). Renamed the underlying wire event `statechange` → `videostatechange`; the public `onStateChange` prop is unchanged (#539).

## [0.10.0] - 2026-06-23

### Added

- `@sigx/lynx-cli` — first-class **build variants**: a `variants` map in `signalx.config.ts` and a `--variant <name>` flag (or `SIGX_VARIANT`) on `prebuild` / `build` / `run:android` / `run:ios` / `dev`, so a dev/staging/preview build installs **alongside** the production app instead of overwriting it. Each variant is a deep-partial config override plus convenience fields (`idSuffix`, `nameSuffix`, `schemeSuffix`, `extends`, `release`, `iconBadge`); `resolveConfig` deep-merges it and auto-suffixes the app id / display name / deep-link scheme, with per-variant output dirs (`android-<name>/`, `ios-<name>/`). Extras: automatic iOS signing for non-release variants, OTA channel auto-bind, an auto launcher-icon badge, and a runtime `variant` / `isVariant()` / `isBaseBuild()` flag (`__SIGX_VARIANT__`, also exposed natively). Base builds (no flag) are byte-for-byte unchanged (#531).
- `@sigx/lynx-video` — `<VideoPlayer>` gains a `startTime` prop (a one-shot initial seek in seconds applied before the first play, for resume / deep-link into a clip) and an `onStateChange` event (`bindvideostatechange`) firing `playing` / `paused` / `buffering` / `ended` transitions with `{ state, positionMs }`, surfacing OS- and controls-driven pauses the declarative `playing` prop can't observe. New exports: `VideoPlaybackState`, `VideoStateChangeEvent`, `VideoStateChangeEventDetail` (#532).

## [0.9.2] - 2026-06-22

### Fixed

- `@sigx/lynx-webauth` — iOS: fix a typo'd protocol name (`ASWebAuthenticationSessionPresentationContextProviding` → `ASWebAuthenticationPresentationContextProviding`) that made `WebAuthModule.swift` fail to compile, so the package could not build into an iOS app at all in 0.9.0/0.9.1.

## [0.9.1] - 2026-06-18

### Fixed

- `@sigx/lynx-webauth` — Android: on a programmatic `AbortSignal` cancel, keep consuming a late redirect from a still-open Custom Tab until the tab is dismissed, so an abandoned auth flow can't leak back as a global `Linking` 'url' event (#523).
- `@sigx/lynx-webauth` — validate `authorizeUrl` is an `http(s)` URL on both platforms (and drop the dead `Uri.parse` catch on Android); normalize a full redirect URI down to the bare scheme; distinguish "missing required parameter" from "invalid authorizeUrl" in error messages (#523).

## [0.9.0] - 2026-06-18

### Added

- `@sigx/lynx-webauth` — new package: a system web-auth-session primitive for OAuth / OpenID-Connect sign-in. `openAuthSession(authorizeUrl, callbackScheme, options?)` presents `ASWebAuthenticationSession` on iOS and Chrome Custom Tabs on Android, returning the callback URL inline (`{ url }` / `{ canceled: true }` / `{ error }`). Supports `AbortSignal`, iOS ephemeral sessions, and Android toolbar color / preferred browser. Ships an opt-in `@sigx/lynx-webauth/oauth` helper (PKCE per RFC 7636, `state`, callback parsing) — pure JS, no token-exchange opinions (#518).
- `@sigx/lynx-linking` — `LinkingState.addInterceptor` (Android): a one-shot URL interceptor consulted before a deep link is published, so a claimed URL (e.g. an OAuth callback) isn't also delivered as a `Linking` 'url' event. Used by `@sigx/lynx-webauth` (#518).

## [0.8.1] - 2026-06-18

Toolchain-compatibility release: unblocks mobile release builds on current CI toolchains (Xcode 26 and Linux runners). Also rounds out the `@sigx/lynx-daisyui` form/disclosure components.

### Added

- `@sigx/lynx-daisyui` — `Table` component (#513).
- `@sigx/lynx-daisyui` — `Range` (slider) form control (#512).
- `@sigx/lynx-daisyui` — `Collapse` / `Accordion` disclosure component (#511).
- `@sigx/lynx-daisyui` — `Rating` star-input form control (#506), with half-step support via `allowHalf` (#510).

### Fixed

- `@sigx/lynx-cli` — the generated iOS `Podfile` now appends `-Wno-c99-designator` to every pod target (including per-pod subprojects). Xcode 26's clang flags the Lynx C++ core's C99 designated initializers, and the pod compiles with `-Werror`, which aborted the archive (`** ARCHIVE FAILED **`); this unblocks iOS release builds on Xcode 26 (#516).
- `gradlew` template — pinned to LF via a new repo-level `.gitattributes`. A publish with `core.autocrlf` enabled had shipped the wrapper with a CRLF (`#!/bin/sh\r`) shebang, failing on Linux/macOS with `bad interpreter: /bin/sh^M: no such file or directory`; this restores Android builds from the generated project (#516).
- `@sigx/lynx-daisyui` — `Rating` colors now apply via CSS classes, with a horizontal layout (#508).

## [0.8.0] - 2026-06-15

Adopts **sigx core 0.7.0** (`@sigx/reactivity` / `@sigx/runtime-core`) across the runtime, and ships the accumulated backlog: the `use:*` directive system with the built-in `show` directive, the `Platform` API with build-time platform splitting, the W3C-shaped `@sigx/lynx-webrtc` module, and `@sigx/lynx-device-info` folded into `@sigx/lynx-core` (breaking `DeviceInfo` shape).

### Added

- `@sigx/lynx-runtime` — `use:*` directive system wired into the renderer, with the built-in **`show`** directive. `use:show={cond}` toggles an element's visibility via `display` while keeping it mounted (a single style op + preserved native state like input focus/value and scroll position), unlike conditional rendering which unmounts/remounts. Define custom directives with `defineDirective` (typed via the `LynxDirective`/`DirectiveAttribute` helpers) and register them with `registerBuiltInDirective` or per-app `app.directive()`. Also fixes a latent style-dedup issue where a `show`-hidden element re-emitted `display:none` on every re-render (#491).
- `@sigx/lynx-testing` — the test renderer now runs the `use:*` directive lifecycle, so `use:show` and custom directives work in component tests. `use:show` toggles a node's effective `_style.display` (kept mounted), assertable via the new `TestNode.isVisible` getter; custom directives' `created`/`mounted`/`updated`/`unmounted` hooks fire. The shared directive runtime in `@sigx/lynx-runtime` is now host-agnostic (`DirectiveHost`), and `show` is a per-host definition (the test host gets a `TestNode`-based one) (#493).
- `@sigx/lynx-core` — `Platform` API for platform checks & rendering, sourced from the Lynx `SystemInfo` global and re-exported from `@sigx/lynx`: `Platform.OS` (`'ios' | 'android' | 'web'`), `Platform.Version`, `pixelRatio`/`pixelWidth`/`pixelHeight`, best-effort `isPad`, and `Platform.select({ ios, android, web, native, default })`. Plus build-time, tree-shakeable platform splitting: `@sigx/lynx-plugin` injects `__WEB__` / `__NATIVE__` defines per rspeedy environment (typed via `@sigx/lynx/client`) and resolves `.web.tsx` / `.lynx.tsx` / `.native.tsx` file extensions ahead of the generic file (web↔native only; iOS↔Android stay runtime) (#484).
- `@sigx/lynx-webrtc` — W3C-shaped WebRTC module (Android + iOS): `RTCPeerConnection` (offer/answer, trickle + non-trickle ICE, `iceServers`, state events, `ontrack`, `ondatachannel`), `RTCDataChannel` (text + binary), `mediaDevices.getUserMedia({ audio })` with browser-style `NotAllowedError` on denial, and `MediaStream`/`MediaStreamTrack` (`enabled` mute, `stop()`). Remote audio plays automatically through the device audio module. Non-W3C extras: `WebRTC.setAudioOutput('speaker'|'earpiece')` and the camera/audio-style `requestPermission()`/`getPermissionStatus()` (#479). iOS rides WebRTC's `RTCAudioSession` manual-audio mode (`.playAndRecord`/`.voiceChat`, defaultToSpeaker, background `audio` mode).

### Changed

- `@sigx/lynx-core` — `DeviceInfo.getInfo()` now resolves a **platform-discriminated** `DeviceInfoResult` instead of returning the raw native payload verbatim. The native modules normalize to one documented shape: a guaranteed common core (`platform`, `manufacturer`, `model`, `brand`, `systemName`, `systemVersion`, `appVersion`, `deviceId`, `screenWidth`, `screenHeight`, `screenScale`) plus a `platform` discriminant narrowing to per-platform extras (`IosDeviceInfo`: `modelName`, `appBuildNumber`, `bundleId`; `AndroidDeviceInfo`: `sdkVersion`, `appPackage`). Breaking: `screenWidth`/`screenHeight` are now density-independent points (dp/pt) on **both** platforms — Android previously reported physical pixels — and `screenDensity` was renamed to `screenScale` (the dp→px multiplier). Re-run `sigx prebuild` to pick up the native changes (#486).
- `@sigx/lynx-runtime`, `@sigx/lynx`, `@sigx/lynx-appearance`, `@sigx/lynx-safe-area`, `@sigx/lynx-testing` — adopt **sigx core 0.7.0**: `@sigx/reactivity` and `@sigx/runtime-core` bumped `^0.6.3` → `^0.7.0`. Core 0.7.0 types a declared slot accessor as optional, so `@sigx/lynx-daisyui`'s `<Divider>` now calls `slots.default?.()` (an absent `default` slot is treated as no label content) (#499).
- `@sigx/lynx-cli` — bump the sigx CLI toolchain: `@sigx/cli` `^0.4.1` → `^0.4.2` and `@sigx/terminal` `^0.5.0` → `^0.6.1` (#499).

### Removed

- `@sigx/lynx-device-info` — folded into `@sigx/lynx-core`. The `DeviceInfo` API is unchanged but now imports from `@sigx/lynx` (or `@sigx/lynx-core`); its native module is served by core's own `SigxCore` module. Remove the `@sigx/lynx-device-info` dependency and re-run `sigx prebuild` (#484).

### Fixed

- `scripts/publish.js` — already-published skip filters were quoted with single quotes, which cmd.exe treats as literal characters: on Windows a partial-failure re-run selected zero projects and quietly published nothing. Filters now use double quotes, valid on both cmd.exe and POSIX shells (#477).
- iOS red-box crash `Exception occurs while updating property … -[NSNull length]: unrecognized selector` when an optional native string prop was left unset (e.g. a `<Map>` without `mapType`). A JS `undefined`/`null` prop reaches native as `NSNull`, and the affected `NSString *` setters bridged it with `value as String?` — which messages `NSNull` with `-length` and crashes. Hardened every `NSString *` prop setter in `@sigx/lynx-maps`, `@sigx/lynx-webview`, `@sigx/lynx-richtext` and `@sigx/lynx-video` to use the type-checked `value as? String` (returns `nil` for `NSNull`), and `@sigx/lynx-maps` now omits unset optional string props instead of emitting them (#475).

## [0.7.0] - 2026-06-12

New module: `@sigx/lynx-sqlite`. Breaking: `Updates.configure()` → `defineUpdates()`. lynx-cli moves to the sigx CLI 0.4 fluent arg contract.

### Added

- `@sigx/lynx-sqlite` — embedded SQLite database module (Android + iOS, platform-provided SQLite, no bundled C library): `openDatabase`, parameterized `execute`, atomic `executeBatch`, interactive `transaction()`, `PRAGMA user_version` migrations, and a `useLiveQuery` hook that re-runs queries when their tables are written — the persistence layer for chat-style offline-first apps (#466).

### Changed

- `@sigx/lynx-cli` — plugin arg schemas migrated to `@sigx/cli@0.4.x`'s fluent `a.*` builders (`@sigx/args` under the hood); requires sigx CLI >= 0.4.0 (#468). `sigx add`/`sigx remove` now declare their module names as a proper rest argument (the new parser no longer passes loose positionals via `args._`), and every flag gets typed `--help` output. User-visible deltas inherited from the CLI: unknown flags now error instead of being silently ignored, and boolean flags accept `--no-<flag>` negation.

## [0.6.1] - 2026-06-12

### Added

- `@sigx/lynx-updates` — OTA bundle updates: pluggable `UpdateProvider` backends (static-manifest built in), silent / immediate / mandatory / manual modes, native streaming download with SHA-256 verify, two-phase apply with crash-driven rollback, and a prebuild-computed runtime-version fingerprint that refuses updates requiring a newer native build (#432).
- `@sigx/lynx-updates-ui` — prebuilt update UI on daisyUI: `<UpdateGate>` (mandatory blocking), `<UpdatePrompt>`, `<UpdateProgress>`, `<UpdateReadyBanner>` (#432).
- `@sigx/lynx-cli` — `sigx updates:publish` packages a built bundle into a static-host OTA layout; `bundleResolverClass` autolink hook + always-generated `GeneratedBundleResolver` lets a linked package redirect startup bundle loading; runtime-version fingerprint computed at prebuild (`.sigx/runtime-versions.json`, Android manifest meta-data, iOS `SigxRuntimeVersion` Info.plist key); `updates` block in `signalx.config.ts` (#432).
- `@sigx/lynx-plugin` — `__SIGX_RUNTIME_VERSIONS__` / `__SIGX_UPDATES_CHANNEL__` build defines (#432).
- `@sigx/lynx-cli` — typed passthrough for native app config without a dedicated field, applied on every prebuild (no post-prebuild patching). iOS `ios.infoPlist` merges arbitrary Info.plist keys (scalars, arrays, nested dicts) and `ios.usesNonExemptEncryption` is a convenience for `ITSAppUsesNonExemptEncryption` (clears App Store "Missing Compliance"); Android `android.applicationAttributes` merges arbitrary `<application>` attributes (the counterpart to `manifestMetaData`). Native modules can declare the same `infoPlist` / `applicationAttributes` in `signalx-module.json`; app config wins on key collision (#456).

## [0.5.7] - 2026-06-12

### Added

- `showcase` — Gestures & Motion area: 7 gesture/animation demos (#421).

### Fixed

- `lynx-cli` — iOS Release archive failed to compile: the generated `ContentView.swift` referenced `DevPerfMetric` (a `SigxDevClient` type excluded from Release via `EXCLUDED_SOURCE_FILE_NAMES`) outside a `#if DEBUG` guard. The `perfMetrics` state is now DEBUG-gated, matching its other usages.

## [0.5.6] - 2026-06-10

### Added

- `@sigx/lynx-heroui` — Checkbox / Toggle / Radio / Select adopt the sigx `model` two-way binding, matching daisyUI (#405).

### Fixed

- `@sigx/lynx-runtime` — `<input>` / `<textarea>` `model` binding now displays the bound value (prefill / edit), not just write-back. The value is applied via a short deferred `setValue` after the native view is laid out, since iOS ignores the `value` attribute and an in-mount-batch `setValue` for initial display (#404).

## [0.5.5] - 2026-06-10

### Fixed

- `@sigx/lynx-dev-client` — graceful 404 for missing CSS hot-update files, stopping a spurious HMR error (#396).
- `@sigx/lynx-dev-client` — dedupe the error overlay with LogBox, filter HMR noise, and parse Lynx-JSON errors (#394).

### Changed

- `@sigx/lynx-plugin` — de-flake the icons-apply integration test (#398).
- Docs — update the stale module count in the README (25+ → 40+) (#392).

## [0.5.4] - 2026-06-10

### Added

- `@sigx/lynx-dev-client` — reason-first error overlay: collapsible stack, multi-error pager, copy (#389).
- `@sigx/lynx-plugin` — transparent bare `fetch()` on Lynx via `ProvidePlugin` (#384).
- `@sigx/lynx` — re-export `fetch` from the umbrella (Lynx 0.5.0 bare-fetch fix) + docs (#380).

### Fixed

- `@sigx/lynx-cli` — add R8 `-dontwarn` for the SmartRefreshLayout/material gap (#385).
- `@sigx/lynx-richtext` (iOS) — guard `NSNumber` prop setters against `NSNull` (#381).

### Changed

- Docs — repoint homepage/docs links to sigx.dev and trim README drift (#388); surface logging/observability in the root README + showcase config (#382).

## [0.5.3] - 2026-06-09

### Added

- `@sigx/lynx-dev-client` — surface uncaught errors in dev (terminal + richer iOS overlay) (#376).
- `@sigx/lynx-cli` — `sigx doctor` checks `@sigx/lynx-*` version consistency + staleness (#372).
- Logging — declarative `signalx.config.ts` config + release observability auto-wiring (Phase 2b) (#369).

### Fixed

- `@sigx/lynx-http` — global `fetch` must win on the Lynx runtime (Lynx 0.5.0 engine-fetch regression) (#374).

### Changed

- Docs — trim the README package tables, point to sigx.dev/lynx (#363).

## [0.5.2] - 2026-06-09

### Added

- `@sigx/lynx-core` — logging layer: leveled + namespaced logger with HTTP request/timing logs (#352).
- `@sigx/lynx-observability` — opt-in production error capture + provider-agnostic sinks (logging Phase 2) (#361).
- `@sigx/lynx` — re-export the logger from the umbrella for app code (#359).
- `@sigx/lynx-cli` — stable dev-server port + reload-on-reconnect (#350); invalidate build caches on a dependency version change (#353).
- `@sigx/lynx-dev-client` — iOS dev-feature parity with Android + a connection banner (#357).

### Fixed

- `@sigx/lynx-dev-client` — stop double-logging device console lines in the dev terminal (#365).

## [0.5.1] - 2026-06-09

### Added

- `showcase` — Fetch demo: status check, upload progress bar, streaming-markdown render (#345).

### Fixed

- `@sigx/lynx-http` — deliver fetch events as a JSON string so `Response.status` survives the Lynx 0.5.0 bridge (#343).

## [0.5.0] - 2026-06-08

Major release: the `@sigx/lynx-zero` neutral foundation + the `@sigx/lynx-heroui` pilot design system (epic #219), a web build target, and WHATWG `fetch`.

### Added

- `@sigx/lynx-zero` — neutral UI foundation: shared contract, style utils and press constants (#221); layout primitives `Row`/`Col`/`Center`/`Spacer`/`ScrollView` (#223, #224); theme engine moved from daisyui (#227); soft color tokens (#235); headless tabs selection context (#238); shared Tailwind preset (#242); `SwiperIndicator` hoisted from daisy (#317, #318).
- `@sigx/lynx-heroui` — HeroUI pilot package + theme data (#231); pilot components + showcase Lab (#233); forms batch 1 — Textarea/Toggle/Checkbox/Radio (#297, #299); forms batch 2 + layout — Select/FormField/Divider (#300, #301); feedback + data — Badge/Alert/Loading/Progress/Skeleton/Steps/Avatar (#303, #304); `NavHeader` + `NavTabBar` (#324, #325); `NavDrawer` (daisy parity) (#328, #331).
- Web target — `sigx run:web` build/serve/live-reload (#326, #327); web template emit from the plugin (#305); `Gesture.Tap` on web (#316, #319); LongPress + Pan gestures on web (#320, #321).
- `@sigx/lynx-http` — WHATWG `fetch` + `FormData` multipart upload, default-wired through `@sigx/lynx` (#249, #253); streaming response bodies via `res.body.getReader()` for SSE (#250, #289).
- `@sigx/lynx-daisyui` — two-way `model` binding for form controls (#323); Divider label slot (#217); `SwiperIndicator` index-only animation (#215); `NavTabBar` standalone mode (#214); `Text` `autoSize` for Lynx 3.8 (#167, #213); Button accessibility passthrough (#237, #246).
- `@sigx/lynx-core`! — shared native runtime: `SigxActivityHolder` + iOS top-presenter (#257, #276).
- `@sigx/lynx-navigation` — `'sheet'` presentation: partial-height bottom sheet with snap points (#259, #273).
- `@sigx/lynx-datetime-picker` — native date/time picker module (#251).
- `@sigx/lynx-file-picker` — generic native file picker + FileSystem binary read (#248, #252).
- `@sigx/lynx-emoji` — themable emoji picker package (#218).
- `@sigx/lynx-markdown`! — editor surface moves to the `./editor` subpath (#177, #245); block-level WYSIWYG — lists, blockquote, code block, headings 4–6, links (#153, #200); reference mention plugin (#157 part 2, #198); `MarkdownEditor` fullscreen overlay + fixed-mode polish (#154, #202).
- `@sigx/lynx-richtext` — native mention chips: U+FFFC attachment pills + `insertChip` (#157 part 1, #184).
- `@sigx/lynx-runtime` — install a web-standard `queueMicrotask` global in the BG bootstrap (#298).
- `@sigx/lynx-cli` — device support & orientation (#197); icon & splash modernization (#195); post-prebuild hook (#190); iOS CI archivability (#187); exclude the iOS dev client from Release builds (#199); warn on x86_64 Android targets where Lynx SVG icons render blank (#270, #279).
- Native — bump Lynx/PrimJS pins from 3.7.0 to 3.8.0 (#207).
- `showcase` — HeroUI components area + Foundation page (#288, #295); DaisyUI component reference catalog (#209); searchable example catalog (#206).

### Fixed

- `@sigx/lynx-runtime-main` — apply animated styles via raw `__SetInlineStyles` on web (#312, #313); handle keyed moves in `<list>` diffing (#277).
- Web — make tap→navigation work (Haptics no-op + gesture PAPI guard) (#310, #311); guard runtime `setProperty` so SignalX apps render on web (#307, #308).
- `@sigx/lynx-runtime` — expand the inline-style `flex` shorthand into longhands (#266).
- `@sigx/lynx-daisyui` — Modal no longer closes on taps inside the box (#268); themed text & placeholder colors on native Input/Textarea (#225, #243).
- `@sigx/lynx-zero` — nested `ThemeProvider` no longer collapses to zero height inside scroll content (#269, #271); screen-theme subpath packaging + Modal placeholder alignment (#240).
- `@sigx/lynx-cli` — keep the Android version catalog managed, `--clean` does a full re-scaffold (#334, #337); fix `run:ios` picking up a stale `.app` from another checkout's DerivedData (#244); restrict cleartext traffic to debug builds (#193).
- `@sigx/lynx-permissions` — declared as a dependency of permission-using modules (#283); declare `androidx.fragment` 1.8.5 so `lintVitalRelease` passes (#191).
- `@sigx/lynx-richtext` — qualify `CGFloat.greatestFiniteMagnitude` for Xcode 26 (#205); Android spans recolor live on theme switch (#155, #201).
- Sheet — animation feel + drag-gesture fixes + showcase examples (#290, #291, #285, #284, #286, #258).

### Changed

- `@sigx/lynx-daisyui`! — color/variant split per the shared contract (#229).
- Icon-color resolver hoisted to the zero `ThemeProvider` (#324, #325).
- Docs — root README full-stack pitch rewrite (#275); README-upkeep rules in AGENTS.md (#267); document the built-in global `fetch` (#292, #293).
- Chore — sync standard scripts from `signalxjs/repo-template` (#338); add `codecov.yml` patch-coverage gate (#339).

## [0.4.9] - 2026-06-05

### Added

- `@sigx/lynx-markdown` — parser inline extensions for the P3 plugin API, part 1 (#170).
- `@sigx/lynx-markdown` — editor plugin API: trigger sessions + suggestion popup, P3 plugin API part 2 (#176).
- `@sigx/lynx-markdown` / `@sigx/lynx-daisyui` — pluggable `EditorToolbar` (generic + daisyUI) (#169).
- `@sigx/lynx-cli` — env-driven Android release signing with debug fallback (#186).

### Fixed

- `@sigx/lynx-richtext` (Android) — the `editable` prop now defaults to `true`
  when null/absent (`defaultBoolean = true`, mirroring iOS's `?? true`).
  Previously an explicitly-undefined `editable` coerced to `false`, leaving the
  EditText disabled and unfocusable — a `MarkdownEditor` without `disabled` was
  completely inert on Android (#182).
- `@sigx/lynx-markdown` — `MarkdownEditor` now passes a concrete boolean to
  `<sigx-richtext>`'s `editable` (`props.disabled !== true`) instead of
  `undefined`, so no platform has to guess a default.

## [0.4.8] - 2026-06-05

### Added

- `@sigx/lynx-richtext` — new package: a native rich-text input element
  (`<sigx-richtext>`, UITextView / EditText) with attributed editing over a
  flat span-based `RichDoc` bridge model, selection events with active formats
  + caret rect, auto-height reporting, IME-safe versioned `setDocument`, and
  fire-and-forget formatting commands (`RichTextMethods`). v1 covers
  bold/italic/strike/code/link + headings.
- `@sigx/lynx-markdown` — `MarkdownEditor`: true-WYSIWYG markdown editing on
  `<sigx-richtext>` (optional peer). External contract is markdown
  (`value`/`onChange`); converters map markdown ↔ the rich span model with an
  extent-aware serializer and a lossless `raw`-block escape hatch for
  not-yet-modeled syntax (lists, tables, code fences). Chat-style sizing
  (`minLines`/`maxLines` auto-grow, `fixed`, `fullscreen`) and an imperative
  controller (`toggleBold`, `setHeading`, `clear`, …). The showcase gains a
  **Markdown editor lab** and a **Markdown composer lab** (the full chat-composer
  shape: editor + formatting toolbar riding `KeyboardStickyView`, scroll-to-newest
  on send).
- `@sigx/lynx-daisyui` — `useMarkdownEditorTheme()`: reactively resolves the
  active theme's palette (normalized to hex — the native element can't read
  CSS variables) into `MarkdownEditor` color props; a theme switch recolors
  the editor live.
- `@sigx/lynx-runtime` — `ignore-focus` is now a typed common JSX attribute.
  Put it on input-accessory chrome (toolbars, send bars): without it, iOS
  dispatches `endEditing:` on any touch-down outside the focused field and
  folds the keyboard before the tapped command can run.

### Fixed

- `@sigx/lynx-gestures` — dynamic `Pressable` `disabled` never reached the
  main-thread gesture worklets (the BG-side ref write doesn't cross threads):
  a Pressable mounted disabled stayed dead at the gesture layer forever, even
  after the prop flipped to enabled. Changes now ship via a `runOnMainThread`
  worklet. Affects every Pressable-based control (`Button`, …).
- `@sigx/lynx-webview` — `enable-debug` prop setter took a primitive `Bool`,
  which the `propSetterLookUp` bridging path fills with object pointer bits;
  now `NSNumber?` with manual unboxing (latent, same class of bug as the
  richtext `editable` issue found during P1 QA).

### Removed (breaking)

- `@sigx/lynx-markdown` — removed `XMarkdown` (the thin wrapper around Lynx's
  platform-gated native `<x-markdown>` XElement) and its `x-markdown` JSX
  intrinsic/event types. `MarkdownView` is the package's only renderer; it is
  cross-platform and fully replaces the native element use case.

## [0.4.7] - 2026-06-04

### Added

- `@sigx/lynx-keyboard` — new package: soft-keyboard handling with an RN-mirroring API. `<KeyboardStickyView>` (aliases `KeyboardAccessoryView`/`KeyboardToolbar`) pins a composer bar + accessory toolbar to the keyboard's top edge with an MT-animated `translateY`; `<KeyboardAvoidingView>` (`padding`/`translate`/`height` behaviors) keeps content above the keyboard via inline BG styles; `useKeyboard()`/`useKeyboardLift()`/`useKeyboardLiftSV()` expose the state, the lift math (`max(0, keyboard − bottomInset)`) and a smoothly animated SharedValue. Builds on the `keyboard` inset already published by `@sigx/lynx-safe-area` — no new native module. The showcase gains a **Keyboard lab** (Settings tab) demonstrating the chat-composer shape.

### Fixed

- `@sigx/lynx-runtime` — programmatic writes to a model-bound `<input>`/`<textarea>` (clear-on-send, editor toolbar inserts) now repaint the native field. The `value` attribute is initial-only once the user has edited the field, so the runtime additionally pushes such writes through the element's `setValue` UI method (new `INVOKE_UI_METHOD` op). The model echo of the user's own typing is suppressed, leaving cursor/IME composition untouched while typing. (#143)

## [0.4.6] - 2026-06-03

### Added

- `@sigx/lynx-markdown` — replaced the thin `<x-markdown>` wrapper with a SignalX-native, streaming-aware markdown renderer. `<MarkdownView>` parses markdown in JS (zero dependencies) and renders to native `<view>`/`<text>` primitives, so it renders identically on every platform. It exposes a render-function `components` override map (any design system can control the look) and ships `createMarkdownStream()` for flicker-free incremental rendering of AI output. Core CommonMark + GFM. The previous native-element wrapper is preserved as `XMarkdown`.
- `@sigx/lynx-daisyui` — ships `markdownComponents`, a themed daisyUI mapping for `@sigx/lynx-markdown` (optional peer dependency).

### Changed (breaking)

- `@sigx/lynx-markdown` — the renderer export was renamed `Markdown` → `MarkdownView` (making room for a future `MarkdownEditor`). The previous `Markdown` component (the `<x-markdown>` wrapper) is now `XMarkdown`.

## [0.4.0] - 2026-05-19

First lockstep release: every publishable `@sigx/lynx-*` package now ships at the same version. Bump together from here on. See [`RELEASING.md`](./RELEASING.md#versioning-lockstep).

### Changed (breaking)

- `@sigx/lynx-cli` — config file renamed from `sigx.lynx.config.{ts,js,mjs}` to `signalx.config.{ts,js,mjs}`. Hard cut — the legacy name is detected on load and produces a `Found legacy sigx.lynx.config.ts — rename to signalx.config.ts` error pointing at the migration. Rename the file (`git mv`); contents stay identical.
- `@sigx/lynx-cli` — native modules are now auto-discovered from the consumer app's installed dependencies. Any package shipping a `signalx-module.json` manifest is linked automatically the next time `sigx prebuild` runs; the explicit `modules: [...]` array is now optional and only needed when you want to pass per-module `config: {…}`, restrict `platforms: [...]`, or `disabled: true` an installed module. To skip a module that's installed transitively, add `excludeModules: ['@sigx/lynx-foo']`.
- Native modules — manifest filename renamed from `sigx-module.json` to `signalx-module.json` across all `@sigx/lynx-*` packages. Republish your own native modules with the new filename + matching `package.json` `exports` entry.

Future releases will be auto-generated from PR titles via Release Drafter.

## [0.1.8] - 2026-05-13

### Added

- `@sigx/lynx-cli` — `sigx dev` now auto-runs `prebuild` on first invocation when the project has a `sigx.lynx.config.ts` but no `android/` or `ios/` folders yet. Fresh projects scaffolded by `pnpm create @sigx` no longer fall through to the legacy "no iOS or Android targets detected — connect a device or boot a simulator" QR-only mode (same cli code, just gated on the missing folders); the user gets the standard simulator/AVD picker on the very first `pnpm dev`.

- `@sigx/lynx-cli` 0.3.0 — `sigx dev` picker now shows available (shutdown) iOS simulators and (offline) Android AVDs as inline selectable entries, sorted by most-recently-used. Selecting one boots/launches it and proceeds to install + run the app. Previously the picker only listed *currently live* targets and required navigating an extra "+ Boot iOS simulator…" / "+ Launch Android emulator…" sub-picker; cold-start UX is now one-keystroke. `sigx dev --android` / `--all` also auto-launch the most-recent AVD when no Android device is connected, mirroring the existing iOS auto-boot fallback. Toolchain absent (no Xcode simulators, no AVDs) still degrades to a clear empty-state message. Fixes signalxjs/lynx#14.
- `@sigx/lynx-cli` 0.2.0 — pretty-print `xcodebuild` and `gradle` output by default for `sigx run:ios`, `sigx run:android`, and `sigx dev`'s native build paths. A cold iOS build used to dump ~16k lines of clang invocations that looked identical line-to-line; users assumed the build was looping. Output is now filtered to top-level action lines (`▸ Compiling [N] Target/file.cc`, `▸ Linking …`, `▸ Signing …`, `** BUILD SUCCEEDED **`) with errors and warnings always surfaced. Gradle output similarly collapses `UP-TO-DATE`/`NO-SOURCE` tasks and indents ninja CXX progress. If `xcbeautify` is installed (`brew install xcbeautify`), iOS output is piped through it instead — auto-detected, never required. New `--verbose` flag (also `SIGX_VERBOSE=1` / `SIGX_VERBOSE_XCODEBUILD=1`) restores raw streaming for diagnostics. Zero new npm dependencies. Fixes signalxjs/lynx#15.
- Initial extraction of `@sigx/lynx*`, `@sigx/lynx-runtime*`, `@sigx/lynx-cli`, and `@sigx/lynx-testing` from `signalxjs/core` into a dedicated repository.
- `@sigx/lynx` un-privatized: first publishable build with `index`, `jsx-runtime`, and `jsx-dev-runtime` entry points.
- `@sigx/lynx-daisyui` un-privatized: first publishable build with shared CSS asset copy.
- Native modules (`@sigx/lynx-{camera,clipboard,device-info,file-system,haptics,image-picker,linking,location,network,notifications,permissions,safe-area,share,storage}`) now ship `sigx-module.json` for `@sigx/lynx-cli` auto-linking.
- npm Trusted Publishing (OIDC) release workflow.
- `RELEASING.md` with dist-tag strategy (publish to `@beta` first, soak, promote to `@latest`).

### Fixed

- `@sigx/lynx` 0.1.2 — `0.1.1` was published with `"@sigx/lynx-runtime": "workspace:^"` unresolved in its dependencies (an earlier publish bypassed `pnpm publish -r`'s rewrite). `pnpm install` would fail with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` for any consumer.
- `@sigx/lynx-plugin` 0.2.5 — `0.2.4` was published referencing the obsolete `@sigx/runtime-lynx-internal` (the pre-rename name). Republished against the canonical `@sigx/lynx-runtime-internal`.
- `@sigx/lynx-runtime` 0.2.4, `@sigx/lynx-runtime-internal` 0.2.4, `@sigx/lynx-runtime-main` 0.2.4 — first publish under the renamed names. The old `@sigx/runtime-lynx*` packages on npm are orphaned tarballs from the `signalxjs/core` era.
- `@sigx/lynx-dev-client` 0.1.1 — `sigx-module.json` was listed in `exports` but missing from `files`, so the published tarball didn't contain the manifest. Without it, `@sigx/lynx-cli` couldn't auto-discover the package and iOS builds failed with "cannot find SigxDevClient in scope".
- `@sigx/lynx-cli` 0.1.1 — `scaffoldAndroid` now force-chmods `gradlew` to 0o755 after copy. npm normalizes file modes to 0o644 in tarballs (except `bin` entries), so the exec bit set on the template was being stripped during publish — consumers got a non-executable `gradlew`.

### Deferred

- `@sigx/lynx-navigation` remains private in v0.1: depends on the unreleased `@sigx/motion`. Will ship in a follow-up release.
