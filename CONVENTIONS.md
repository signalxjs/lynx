# SignalX for Lynx — module conventions

The API contract every `@sigx/lynx-*` package follows, the rubric module reviews are graded
against, and the protocol an agent uses to drive a review issue to completion.

`AGENTS.md` is the workflow guide (branch, PR, review, merge). **This file is the product
contract** — what a module's API must look like, regardless of who writes it.

Every convention below was derived by comparing the packages that exist today; the rule is what
the plurality already does. Where packages disagree, the disagreement is named with `file:line`
so the fix is unambiguous. Citations are accurate as of the commit that introduced this file;
if one has rotted, fix the citation in the same PR as the code.

## How this is enforced

Two CI gates cover the mechanically-checkable parts:

| Command | Covers |
|---|---|
| `pnpm check:conventions` | C2 (bare and async `isAvailable`), C6 (`PermissionResponse` re-export), C10 (thrown-message prefix), C11 (`## Web` section) |
| `pnpm check:manifests` | C12 (method names agree across JS ↔ manifest ↔ Swift ↔ Kotlin) |

Both are **ratchets, not walls.** This contract was written *from* the packages, so on day one most
rules already had violations — 149 `throw`s exist and 7 carry the required prefix. A gate failing
on all of them could never merge, and a gate that only warned would be ignored. So the existing
violations are recorded in `scripts/api-conventions-baseline.json` and
`scripts/module-manifests-baseline.json`, each owned by a module review issue, and CI fails on:

- a **new** violation, or a counted one that grew, and
- a baseline entry that is **no longer needed** — which is what forces each audit to shrink the
  file rather than leave it to rot.

After fixing violations, re-record and commit the smaller file:

```sh
node scripts/check-api-conventions.mjs --update-baseline
node scripts/check-module-manifests.mjs --update-baseline
```

Everything the gates can't judge — anything needing types, a device, or a human — lives in the
rubric in Part 2 and belongs to the package's review issue.

**Three packages sit outside the review** — `@sigx/lynx-zero-legacy`, `@sigx/lynx-daisyui` and
`@sigx/lynx-heroui` — because the design-system layering has separate work in flight
(signalxjs/lynx#927). They are still bound by C1–C12 and still gated by CI; they simply have no
audit issue owning their baseline entries. The exclusion and its reason live in `EXCLUDED` in
`scripts/lib/audit-units.mjs`, so the generator can't quietly recreate them.

---

## Part 1 — The API contract (C1–C12)

### C1 — Capability namespace

A native-capability package exports **one frozen namespace object** named after the capability,
from `src/index.ts`:

```ts
// packages/lynx-camera/src/camera.ts
export const Camera = { takePicture, recordVideo, requestPermission, isAvailable } as const;
```

Followed by ~20 packages (Camera, Clipboard, Storage, Share, Audio, Haptics, Location, Network,
Notifications, Background, FileSystem, FilePicker, ImagePicker, SecureStorage, …).

**Documented exemptions** — packages that deliberately mirror a web standard export what that
standard exports, because matching the platform beats matching us:

| Package | Mirrors |
|---|---|
| `@sigx/lynx-http` | WHATWG `fetch` / `Request` / `Response` / `FormData` |
| `@sigx/lynx-websocket` | WHATWG `WebSocket` |
| `@sigx/lynx-webrtc` | W3C `RTCPeerConnection` / `MediaStream` |

Packages that are neither (`lynx-appearance`, `lynx-sqlite`, `lynx-webauth`, `lynx-linking`)
export free functions. That is allowed, but it makes C2 mandatory reading — a free function named
generically collides across barrels.

### C2 — `isAvailable()` means "is the native module linked?"

**The rule.** `isAvailable(): boolean`. Always synchronous, always the same question: is the
native module present in this build?

- On a namespace: `Camera.isAvailable()`.
- On a free-function package: `is<Cap>Available()` — `isHttpAvailable`, `isWebSocketAvailable`,
  `isWebRTCAvailable`, `isWebAuthAvailable`. **Never a bare `isAvailable` at package root.**
- A hardware/enrolment/capability check is a **different question** and gets a different name:
  `getCapability()`, `getStatus()`, `isEnrolled()`.

**Current violations.**

| Violation | Where |
|---|---|
| `isAvailable()` returns `Promise<BiometricAvailability>` — asks "is the hardware enrolled?", not "is the module linked?" | `packages/lynx-biometric/src/biometric.ts:88` |
| Consequently the module check is renamed `isModuleAvailable()` | `packages/lynx-biometric/src/biometric.ts:131`, `packages/lynx-datetime-picker/src/datetime-picker.ts:163` |
| Bare `isAvailable` exported at package root — these two **collide with each other** under a barrel import | `packages/lynx-appearance/src/index.ts:31` (→ `setters.ts:85`), `packages/lynx-sqlite/src/index.ts:1` (→ `sqlite.ts:297`) |

The Biometric case is the dangerous one: generic code written as `if (mod.isAvailable())` gets a
truthy `Promise` and proceeds as though the module were present.

**Fix shape:** `Biometric.isAvailable(): boolean` (module linked) + `Biometric.getCapability():
Promise<BiometricCapability>` (hardware + enrolment). Appearance → `isAppearanceAvailable()`,
SQLite → `isSQLiteAvailable()`.

### C3 — Behaviour when the module isn't linked

**The rule.** Throw. `getModule` already produces a descriptive error
(`packages/lynx-core/src/bridge.ts:41-56`) naming the missing module and how to link it, and that
is what a developer needs to see.

**The opt-out.** A package may return a sentinel instead — but only if the reason is written in
**both** the method's JSDoc **and** the README's Gotchas. Haptics is the model: a throw inside a
press handler would abort the caller's interaction for a purely decorative effect, so every
feedback method early-returns (`packages/lynx-haptics/src/haptics.ts:41-53`). That reasoning is
sound and documented; copy the pattern, not just the behaviour.

**Current state — five contracts for one situation:**

| Behaviour | Packages |
|---|---|
| Throws (correct default) | Storage, Clipboard, Share, FileSystem, Location, Network, ImagePicker, FilePicker, Camera |
| Silent no-op (documented, allowed) | Haptics |
| `{ ok: false, reason: 'unsupported' }` | Appearance (`packages/lynx-appearance/src/setters.ts:24`) |
| `{ cancelled: true }` | DateTimePicker (`packages/lynx-datetime-picker/src/datetime-picker.ts:131-132`) |
| `{ error: string }` | Biometric (`biometric.ts:111`), WebAuth (`webauth.ts:104`) |

**DateTimePicker is a live bug, not a style difference:**

```ts
// packages/lynx-datetime-picker/src/datetime-picker.ts:136
.catch(() => ({ cancelled: true }));
```

A bridge failure, a native crash and the user tapping Cancel are indistinguishable to the caller.

### C4 — Unwrapping native results

`callAsync` (`packages/lynx-core/src/bridge.ts:66-75`) rejects only if the *synchronous* call
throws. Native-side failures arrive **on the resolved callback** as `{ error: string }`. Every
package therefore unwraps — and today, five different ways:

| Style | Where |
|---|---|
| `settleCapture` → three-outcome union | `packages/lynx-camera/src/camera.ts:75-113` |
| `unwrap(result, action)` → throws with full-scope prefix | `packages/lynx-secure-storage/src/secure-storage.ts:44-50` |
| `unwrapVoid` → throws with short prefix | `packages/lynx-audio/src/handles.ts:58` |
| inline `if (r?.error) throw` | `packages/lynx-audio/src/audio.ts:70`, `packages/lynx-file-system/src/file-system.ts:41` |
| returns the error as a value | Biometric, WebAuth, Appearance |
| swallows it | DateTimePicker |

**The rule.** Use `unwrapNative<T>(pkg, action, raw)` from `@sigx/lynx-core` (lands in Phase 0b).
It throws `[@sigx/lynx-<pkg>] <action> failed: <native message>`. Returning the error as a value
is a C3 opt-out and carries the same documentation requirement.

### C5 — Cancellation

**Spelling: `cancelled`, two L's**, in every public type. `@sigx/lynx-webauth` is the lone
`canceled` (`packages/lynx-webauth/src/webauth.ts:54-56`).

This is not pedantry — the repo already carries defensive code because the *native* side drifted:

```ts
// packages/lynx-image-picker/src/image-picker.ts:78  (and lynx-file-picker/src/file-picker.ts)
const cancelled = Boolean(raw['cancelled'] ?? raw['canceled'] ?? false);
```

Normalize at the native boundary, then expose one spelling. Don't reintroduce the split in the
public type.

**Shape:**

- Single-result operation → discriminated union: `PhotoResult | { cancelled: true }`
  (`packages/lynx-camera/src/camera.ts:66` is the model).
- Multi-select → `{ cancelled: boolean; assets: Asset[] }`, `assets` defaulting to `[]` so callers
  can always `.map()` (`packages/lynx-image-picker/src/image-picker.ts`).

Cancellation is **not** an error channel. A failure throws (C3/C4); only a genuine user cancel
sets `cancelled`.

### C6 — Permissions

```ts
requestPermission(): Promise<PermissionResponse>
getPermissionStatus(): Promise<PermissionResponse>
```

`PermissionResponse` and `PermissionStatus` come from `@sigx/lynx-core`
(`packages/lynx-core/src/permissions.ts`) and are **re-exported from the package barrel**, so
consumers can type their own state without a second import.

Followed by Camera, Audio, Location, ImagePicker, Notifications. Gaps:

- `@sigx/lynx-webrtc` implements the pair (`src/audio-output.ts:22`) but doesn't re-export the type.
- `@sigx/lynx-web-host` declares its own structural duplicate `HostPermissionResponse`
  (`packages/lynx-web-host/src/host.ts:401-407`) instead of importing core's — free to drift.
- A package that needs no runtime permission (FilePicker — SAF / `UIDocumentPicker`) says so in
  its README Gotchas rather than staying silent.

### C7 — Events and subscriptions

**Return `() => void`.** Calling it unsubscribes; calling it twice is a no-op.

```ts
const off = Notifications.addPushListener(handlePush);
off();
```

`{ remove(): void }` is a React-Native-ism the newer packages already moved past. Two remain:
`packages/lynx-linking/src/inbound.ts:20,53` and `packages/lynx-linking/src/back-handler.ts:7`.
`lynx-navigation` has to know which is which per call site
(`src/hooks/use-linking-nav.ts` vs `src/hooks/use-hardware-back.ts`).

**Naming:** `on<Event>` on a handle (`handle.onEnd`, `handle.onMeter`), `subscribe<Thing>` or
`add<Thing>Listener` at module level. Pick the one that matches the package's siblings and say so
in the README.

**Build on `subscribeNative()` from `@sigx/lynx-core`** (lands in Phase 0b). Sixteen files
currently re-declare the identical `GlobalEventEmitterLike` shim plus `safeParse` plus the
string-or-object payload branch:

```
packages/lynx-appearance/src/provider.tsx      packages/lynx-navigation/src/hooks/use-hardware-back.ts
packages/lynx-audio/src/events.ts              packages/lynx-notifications/src/notifications.web.ts
packages/lynx-background/src/events.ts         packages/lynx-notifications/src/push.ts
packages/lynx-core/src/app-state.ts            packages/lynx-safe-area/src/provider.tsx
packages/lynx-core/src/font-scale.ts           packages/lynx-updates/src/events.ts
packages/lynx-http/src/fetch.ts                packages/lynx-webrtc/src/events.ts
packages/lynx-linking/src/back-handler.ts      packages/lynx-websocket/src/websocket.ts
packages/lynx-linking/src/inbound.ts           packages/lynx-linking/src/linking.ts
```

Each also re-derives the same three edge cases: payload arriving as a JSON string rather than an
object, a listener throwing, and no emitter at all off-device.

### C8 — Reactive reads and hooks

| Returns | Suffix | Example |
|---|---|---|
| `Computed<T>` | none | `useAppState()`, `useFontScale()`, `useKeyboard()`, `useUpdates()`, `useIsFocused()` |
| main-thread read | `MT` | `useFontScaleMT()`, `useSystemColorSchemeMT()`, `useSafeAreaInsetsMT()` |
| `SharedValue<T>` | `SV` | `useKeyboardLiftSV()` |

Violations: `useSheetHeight()` returns a `SharedValue` with no suffix
(`packages/lynx-navigation/src/hooks/use-sheet-height.ts:30`); `useSystemColorScheme` and
`useSafeAreaInsets` return bespoke `ColorSchemeRead` / `InsetsRead` aliases rather than `Computed`.

Context hooks are already consistent and stay as they are: `defineInjectable` +
`use<Thing>Context` / `use<Thing>`.

### C9 — Arguments

**Required identity is positional; everything else is a trailing options object defaulting to `{}`.**

```ts
Storage.setItem(key, value)
SecureStorage.set(key, value, opts = {})
Audio.play(source, options = {})
Camera.takePicture(options = {})
```

Already held nearly everywhere — written down so it stays that way. Two outliers to fix:
`openAuthSession(authorizeUrl, callbackScheme, options = {})` (two configuration positionals) and
`setNavigationBarStyle({ style, color? })` next to its sibling `setStatusBarStyle(style)`
(`packages/lynx-appearance/src/setters.ts:23,53`).

### C10 — Errors and logging

**Thrown messages** carry the full scope: `[@sigx/lynx-<pkg>] <action> failed: <cause>`.
Five styles exist today — `[lynx-audio]` (`packages/lynx-audio/src/audio.ts:70`),
`[@sigx/lynx-secure-storage]`, `[@sigx/lynx-linking]`, `[lynx-navigation]`, and no prefix at all
(`packages/lynx-camera/src/camera.ts:105` rethrows the raw native string).

**Anything a caller might branch on gets a `code`.** Extend `SigxError` from `@sigx/lynx-core`
(Phase 0b), modeled on the one typed error that exists today, `UpdatesError` /`UpdatesErrorCode`
(`packages/lynx-updates/src/types.ts:216`).

**Diagnostics go through `createLogger('<pkg>')`, never bare `console.warn`.** Today 4 of 57
packages use it — `lynx-http`, `lynx-observability`, `lynx-updates`, `lynx-cli`. Everything else
warns directly to the console with five different tags (`[background]`, `[lynx-audio]`,
`[notifications]`, `[BackHandler]`, `[@sigx/lynx-clipboard]`), which means module diagnostics
never reach the leveled, namespaced pipeline the root README says streams to the `sigx dev`
terminal.

### C11 — README template

One template. Sections in this order; omit a section only when it genuinely doesn't apply, and
never omit `## Web`:

```markdown
# @sigx/lynx-<pkg>
One-line statement of what it does.

## 📚 Documentation      → link to the docs site
## Install
## Usage                 → the shortest real example that runs
## API                   → every export, with types
## Web                   → supported / degraded / unsupported, and what to use instead
## Gotchas               → platform quirks, permissions, "won't do" decisions
## License
```

Current state: two competing templates, neither fully applied. Missing `## 📚 Documentation`:
`lynx-list`, `lynx-sheet`, `lynx-sqlite`, `lynx-updates`, `lynx-updates-publisher`,
`lynx-web-host`, `lynx-webrtc`. Missing `## License`: every "Module"-template package. Missing
`## Web`: camera, audio, video, file-system, datetime-picker, sqlite, biometric, webauth, webrtc,
updates — despite nine packages shipping `.web.ts` implementations and `sigx build:web` being a
headline feature. `lynx-zero-legacy`'s README is 29 lines for 2,367 lines of foundation code.

### C12 — `signalx-module.json` must be true

The manifest schema is consistent and good. But `ios.methods` is **dead metadata**: the autolinker
serializes it (`packages/lynx-cli/src/autolink/ios.ts:223`) into a generated `register()` whose
`methods: [String]` parameter is never read (`ios.ts:488-497`).

It has therefore drifted, silently:

| Drift | Package |
|---|---|
| `diagnose` called from JS, absent from the manifest (Swift implements it) | `lynx-haptics` |
| `getColorScheme` declared, never called | `lynx-appearance` |
| `getConstants` declared, never called | `lynx-core` |
| `getState`, `getCurrentUpdate` declared, never called | `lynx-updates` |

**The rule:** every method name passed to `callSync`/`callAsync` appears in the manifest **and**
in the Swift `methodLookup` **and** in the Kotlin module — enforced by
`scripts/check-module-manifests.mjs`.

**Keep the name a string literal at the call site.** The checker reads call sites textually, so
threading the method through a helper —

```ts
const voidCall = (action: string, ...args: unknown[]) => callAsync(MODULE, action, ...args);
voidCall('pausePlayer', id);   // ✗ the gate now sees zero calls
```

— hides every name from it and reports the whole module as declared-but-never-called. This is not
hypothetical: it happened while refactoring `@sigx/lynx-audio`, and the gate caught it. A tidier
wrapper costs more than it saves; repeat the literal. If we decide not to enforce it, the field gets
deleted rather than left as documentation nothing validates.

---

## Part 2 — The audit rubric

Seven dimensions. Every item is answered **PASS / FAIL / N-A plus one line of evidence
(`file:line`)**. Tags:

| Tag | Meaning |
|---|---|
| `[A]` | Automatable — verify by reading or running code, no device |
| `[A*]` | Automatable once a test exists; writing that test **is** the fix |
| `[D]` | Needs a device or emulator — iOS **and** Android |
| `[W]` | Needs `sigx run:web` |

### D1 — Correctness: the features actually work

| # | Item | Tag |
|---|---|---|
| 1.1 | Every exported function has a happy-path test against a faked `NativeModules` global | `[A*]` |
| 1.2 | Every documented failure mode has a test — permission denied, module unlinked, malformed payload, user cancel | `[A*]` |
| 1.3 | Native payloads are normalized defensively: tolerate the payload arriving as a JSON **string** as well as an object, reject arrays/nulls | `[A]` |
| 1.4 | Every `callSync`/`callAsync` method name appears in `signalx-module.json` **and** Swift `methodLookup` **and** the Kotlin module (C12) | `[A]` |
| 1.5 | README and JSDoc examples compile and are true | `[A]` |
| 1.6 | "iOS only" / "Android only" / "Reserved — not yet applied" annotations are accurate against the native source | `[A]` |
| 1.7 | Every capability the README claims, demonstrated end-to-end on **iOS** | `[D]` |
| 1.8 | …and on **Android** | `[D]` |
| 1.9 | …and on **web**, or the README states "native only" explicitly | `[W]` |
| 1.10 | Every `TODO(device-verify)` is resolved or converted into a tracked issue | `[A]` `[D]` |

### D2 — Best practice and code health

| # | Item | Tag |
|---|---|---|
| 2.1 | No `any` / `as any` / `@ts-ignore` in `src/` without an adjacent comment justifying it | `[A]` |
| 2.2 | `tsconfig.json` matches the repo norm for its family | `[A]` |
| 2.3 | `package.json`: `exports` map correct, `files` minimal and justified, no shipping `src/` unless deliberate | `[A]` |
| 2.4 | `sideEffects` declared explicitly — `false` for pure packages, an array for entries that mutate globals | `[A]` |
| 2.5 | `homepage` points at a docs-site URL that exists | `[A]` |
| 2.6 | The barrel exports **only** intended API — no internal constants or helpers | `[A]` |
| 2.7 | Deliberate internal escapes use the leading-underscore convention (`_setRouteRegistry`) | `[A]` |
| 2.8 | Nothing reimplements a helper `@sigx/lynx-core` already owns | `[A]` |
| 2.9 | Non-obvious branches carry a *why* comment, not a *what* comment | `[A]` |
| 2.10 | `pnpm lint` clean; no unjustified `oxlint-disable` | `[A]` |
| 2.11 | Root `CHANGELOG.md` `[Unreleased]` has an entry for every behaviour change | `[A]` |

Reference violation for 2.6: `packages/lynx-sheet/src/index.ts` exports `MIN_DISTANCE`,
`MAX_EPS_PX`, `OWNER_UNDECIDED`, `PROJECTION_SEC`, `decideDragOwner`, `projectReveal`,
`createSheetPan`, `useSheetEngine`.

### D3 — Resource lifecycle

| # | Item | Tag |
|---|---|---|
| 3.1 | Every subscribe returns a disposer that actually calls `removeListener` — proven with a fake emitter that counts registrations | `[A*]` |
| 3.2 | Double-unsubscribe is a no-op; unsubscribing after teardown doesn't throw | `[A*]` |
| 3.3 | Native handles (`AudioHandle`, `RecordingHandle`, `SQLiteDatabase`, `RTCPeerConnection`, `WebSocket`) release native resources on close, and post-close calls fail predictably rather than crashing | `[A*]` `[D]` |
| 3.4 | Module-level singletons survive HMR / double module evaluation, guarded by a `globalThis` flag (the pattern in `packages/lynx-core/src/index.ts`) | `[A]` |
| 3.5 | Components unregister main-thread listeners and native observers on unmount | `[A*]` |
| 3.6 | No unbounded growth — listener bags, task stores and id counters are bounded or documented | `[A]` |
| 3.7 | Every fire-and-forget bridge call has an explicit `.catch()` reporting through `createLogger`. `void callAsync(…)` still rejects when the module isn't linked, and an unhandled rejection here is a **fatal main-thread exception, not a warning** (#863) — the `void` makes it look deliberate | `[A]` |

### D4 — Missing common features vs. the ecosystem peer

| # | Item | Tag |
|---|---|---|
| 4.1 | Comparison table against the named peer filled in; every gap triaged **ship / defer / won't** with a one-line reason | `[A]` |
| 4.2 | Before triaging a gap as **ship**, the native method it needs actually exists in Swift **and** Kotlin — or the native work is scoped into the estimate. A gap that looks like a one-line JS addition routinely needs work on two platforms | `[A]` |
| 4.3 | Every "won't" is documented in the README Gotchas, not only in the issue | `[A]` |
| 4.4 | Every "defer" has a linked follow-up issue | `[A]` |

Peers: `storage`→`@react-native-async-storage/async-storage` · `network`→`netinfo` /
`navigator.onLine` · `location`→`expo-location` · `clipboard`→`expo-clipboard` ·
`file-system`→`expo-file-system` · `share`→RN `Share` · `camera`→`expo-camera` /
`react-native-vision-camera` · `haptics`→`expo-haptics` ·
`biometric`→`expo-local-authentication` · `secure-storage`→`expo-secure-store` ·
`webview`→`react-native-webview` · `notifications`→`expo-notifications` ·
`http`/`websocket`/`webrtc`→the web standard they mirror.

### D5 — Performance

| # | Item | Tag |
|---|---|---|
| 5.1 | No needless bridge round-trips; batched where native supports it; `callSync` only for genuinely cheap reads | `[A]` |
| 5.2 | Large payloads cross as URIs, not base64 (the 33% penalty `lynx-file-system` documents) | `[A]` |
| 5.3 | Import-time work is registration only — measure the barrel's import cost | `[A]` |
| 5.4 | Importing one symbol from the barrel doesn't drag in the package (needs C-2.4 `sideEffects`) | `[A]` |
| 5.5 | Frame-critical work runs in `'main thread'` worklets, not BG round-trips | `[A]` |
| 5.6 | Reactive reads are `Computed`-memoized, not recomputed per render | `[A]` |
| 5.7 | Listeners attach lazily and detach when the last subscriber leaves | `[A]` |
| 5.8 | Anything with a scroll or animation hot path has a benchmark | `[A*]` |
| 5.9 | 60fps held on device for the interaction the package owns | `[D]` |

**Never grade 5.9 from a dev build** — dev builds inflate main-thread costs by roughly 300×.

### D6 — API coherence

| # | Item | Tag |
|---|---|---|
| 6.1 | Conforms to C1–C12, or documents an explicit exception with its reason | `[A]` |
| 6.2 | Uses core's shared helpers rather than a local copy | `[A]` |
| 6.3 | Naming matches siblings for the same concept — `get`/`set` vs `getItem`/`setItem`; `close` vs `stop` vs `dispose` | `[A]` |
| 6.4 | Thrown messages carry the `[@sigx/lynx-<pkg>]` prefix (C10) | `[A]` |
| 6.5 | Diagnostics go through `createLogger`, not `console.warn` (C10) | `[A]` |

### D7 — Demoable, testable, documented

| # | Item | Tag |
|---|---|---|
| 7.1 | A public-surface freeze test exists, modeled on `packages/lynx-navigation/__tests__/public-surface.test.ts` — runtime export-name snapshot plus `expectTypeOf` pins on the load-bearing shapes | `[A*]` |
| 7.1b | For a package shipping a `.web.ts`, that test also asserts **both implementations expose the same surface**. The plugin swaps them by `extensionAlias`, so a method added to one and not the other is a runtime failure on whichever target missed it — invisible to a typecheck, since only one is ever checked against the consumer | `[A*]` |
| 7.2 | The package has a `test` script and its tests run under root `pnpm test` | `[A]` |
| 7.3 | Patch coverage ≥ 80% (`codecov.yml`) for everything the audit touches | `[A]` |
| 7.4 | README matches the C11 template | `[A]` |
| 7.5 | `## Web` section is accurate — supported / degraded / unsupported | `[A]` `[W]` |
| 7.6 | A showcase screen exists, registered in `examples/showcase/src/routes.ts` and listed in `catalog.ts` under the right area — or the audit records an explicit "no demo, because X" | `[A]` |
| 7.7 | The screen exercises **failure** paths — permission denied, module unavailable, cancel — not just the happy path | `[A]` `[D]` |
| 7.8 | The screen renders on web without crashing, or is gated behind an availability check with a clear message | `[W]` |
| 7.9 | A docs-site issue is filed on `signalxjs/signalxjs.github.io` for anything user-facing (mandatory per `AGENTS.md`) | `[A]` |

Infra packages exempt from 7.6–7.8 — `lynx-runtime-internal`, `lynx-testing`,
`lynx-updates-publisher`, `lynx-web-host`, `lynx-plugin`, `lynx-cli` — still record *why* in the
issue rather than leaving the item blank.

---

## Part 3 — The agent working protocol

A module-review issue is self-driving. The issue body is the working document and the status
board: it is expected to change as work proceeds.

### 1. Audit — no code changes

Grade the package against D1–D7. Post the filled table as a comment, then **edit the issue body**
(`gh issue edit <N> --body-file <file>`) turning every FAIL into a checkbox under `## Findings`.
One checkbox per concrete, actionable defect — not per dimension.

### 2. Work the checklist top-down

Each fix, or coherent group of fixes, follows the `AGENTS.md` flow: `pnpm wt new <N-slug>` →
change → `pnpm typecheck` + `pnpm test` → `gh pr create --reviewer @copilot` → address the review
→ squash merge → `pnpm wt rm`.

- **PR bodies say `Part of #<N>`, never `Closes #<N>`.** The audit issue must survive many PRs.
  Only the final PR uses `Closes`.
- After each merge, tick the box **and** comment the PR link, so the issue is an accurate live
  status board rather than a stale plan.
- `codecov/patch` is 80%: every fix carries a test.
- Fixing a convention violation means adopting the shared helper in `@sigx/lynx-core` — not
  writing a local one. If the helper is missing, that is a `@sigx/lynx-core` issue, not a
  workaround.

### 3. Decide what you can; escalate what you can't

Default to **deciding**. Take the option you'd recommend, and write down in the issue what you
chose and why — the reasoning is the deliverable, not the choice alone. Escalate only when the
change is **breaking or user-visible**.

**Ask** — append the question to `## Design questions (blocked)` in the issue body, add the
`needs-decision` label, comment so it notifies, then **carry on with the unblocked items**:

- a change to a public signature or return type
- a breaking rename
- visual or UX behaviour
- adding a native dependency
- dropping a documented capability
- behaviour that would differ per platform

**Decide** — everything else: internal refactors, test additions, README fixes, performance work
with no API change, whether to defer a missing feature, and anything C1–C12 already answers.

One subtlety worth stating, because it's where the rule gets misread: "would differ per platform"
is an *ask* trigger for **shipping** such a thing. Deciding **not** to ship something *because* it
would differ per platform is an ordinary won't-do — decide it, record the reasoning, move on.
Otherwise every won't-do gets escalated and the rule buys nothing.

**Calibration.** Of the first six questions raised across two package reviews, exactly **two**
reached a human under this rule — `Clipboard.setString` changing signature, and
`Audio.subscribeInterruptions` being added. The other four (defer image support, won't-do URL support, won't-do a
change listener, defer progress events) were the agent's to make. If you're escalating much more
than a third of what you hit, the line has drifted.

### 4. Prove the tests you write for bugs

A regression test is evidence only if you have **seen it fail**. Revert the fix, watch the test go
red, restore it. Both pilot reviews did this and one of the tests turned out not to be testing what
it looked like it was testing.

Two things that quietly make a test worthless:

- **Global state.** Don't assert on `process.on('unhandledRejection')` or anything else shared
  across files — in a parallel run another file decides whether you pass. Assert on something the
  test owns, like a logger transport you installed.
- **Testing the mock.** If the fake is doing the thing you're asserting, the test passes with the
  fix reverted. That's what step one catches.

### 5. Done

Every checkbox ticked, or explicitly deferred to a linked follow-up issue. The exit-criteria block
at the bottom of the issue is the definition of done. Then close, referencing the final PR.

**Correct your own audit when it turns out to be wrong.** A finding graded "trivial" that isn't is
worth an explicit note on the issue — the grade is the thing the next person trusts. Both pilots
have a worked example of the audit format: #872 (clean API, no proof) and #867 (a real bug).

---

## Changing these conventions

This file is the shared standard. Changing a convention means changing every package that follows
it — so propose it on the epic first, then land the doc change and the migration together.
Upstream anything workflow-shaped to
[`signalxjs/repo-template`](https://github.com/signalxjs/repo-template), as `AGENTS.md` requires.
