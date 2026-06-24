# Changelog

All notable changes to this repository are documented here. All `@sigx/lynx-*` packages share a single lockstep version — one entry per release covers every package.

## [Unreleased]

### Added

- `@sigx/lynx-dev-client` / `@sigx/lynx-plugin` — **device runtime exceptions now stream to the `sigx dev` terminal.** The native red-screen error sink (Android `LynxViewClient.onReceivedError`, iOS `didRecieveError`) — a *superset* of the JS `lynx.onError` hook that also catches main-thread-script, template, render and native-module errors — is POSTed to a new `/__sigx/device-error` endpoint on the dev log server (dev port + 1) and printed as a `📱 <platform> … ERR …` line, so anything on the on-device red screen is also copyable in the terminal's Logs tab. Errors that also travel the existing JS console path are de-duplicated server-side within a short window, so each error shows up once (#540).

### Fixed

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
