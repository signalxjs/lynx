# Changelog

All notable changes to this repository are documented here. All `@sigx/lynx-*` packages share a single lockstep version — one entry per release covers every package.

## [Unreleased]

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
