/**
 * audit-units.mjs — the module-review campaign's unit list and issue-body
 * renderer (epic signalxjs/lynx#857).
 *
 * Pure functions only, so `scripts/__tests__/audit-units.test.mjs` can prove
 * the interesting property: every package directory is covered exactly once,
 * either as its own audit unit or folded into a sibling. The `gh` calls live
 * in `scripts/audit-issues.mjs`.
 *
 * An audit unit is one GitHub issue that one agent drives to completion. Most
 * units are one package; four packages have no standalone surface and fold
 * into the sibling that defines them (see FOLD).
 */

/**
 * Packages that don't get their own issue, and who absorbs them.
 *
 * The test is "would an agent auditing this in isolation have anything to
 * decide?" — a two-file icon adapter over `defineIconSet` wouldn't; the
 * interesting surface is the build-time subsetting in `lynx-icons` itself.
 */
export const FOLD = {
    'lynx-icons-fa-free': 'lynx-icons',
    'lynx-icons-lucide': 'lynx-icons',
    'lynx-runtime-internal': 'lynx-runtime',
    'lynx-updates-publisher': 'lynx-updates',
};

/**
 * Packages deliberately outside the module review, and why.
 *
 * Explicit rather than simply absent: `buildUnits` treats an unclassified
 * package directory as a hard error on purpose — a package nobody has looked
 * at is the exact thing this epic exists to prevent — so "not audited" has to
 * be a decision someone wrote down, not a gap.
 *
 * An excluded package still has to satisfy the CI gates; it just has no audit
 * issue owning its remaining baseline entries.
 */
export const EXCLUDED = {
    'lynx-zero':
        'Under construction — the zero-contract redesign (signalxjs/lynx#1029). Ships with a public-surface freeze test from its first commit; enters the audit when the pilot milestone completes.',
    'lynx-zero-legacy':
        'Design-system layering work in flight (signalxjs/lynx#927). zero is the neutral foundation the two design systems build on, so auditing it separately would move the contract underneath them.',
    'lynx-daisyui':
        'Design-system layering work in flight (signalxjs/lynx#927) — audited together with lynx-zero-legacy and lynx-heroui or not at all.',
    'lynx-heroui':
        'Design-system layering work in flight (signalxjs/lynx#927) — audited together with lynx-zero-legacy and lynx-daisyui or not at all.',
};

/** Display groups, in the order they appear in the epic body. */
export const GROUPS = {
    foundation: 'Foundation & runtime',
    native: 'Native capability modules',
    ui: 'UI & interaction',
    delivery: 'Delivery & tooling',
};

/**
 * Per-unit metadata the generator bakes into each issue so an agent starts
 * from evidence rather than a blank page.
 *
 *   group    — which section of the epic it belongs to
 *   peer     — the ecosystem package to compare against for D4 (missing
 *              features). Omitted where there is no meaningful peer.
 *   demo     — showcase state: 'yes' (a screen exists), 'no' (a screen is
 *              owed), or 'exempt' (infra — no app-facing surface to demo).
 *   why      — required when demo === 'exempt': the reason, which goes into
 *              the issue rather than leaving D7.6 silently blank.
 *   seeds    — defects the pre-audit already found, with file:line. These are
 *              a starting point, not the finding list; the agent still runs
 *              the full rubric.
 */
export const META = {
    // --- Foundation & runtime -----------------------------------------------
    'lynx': {
        group: 'foundation',
        demo: 'yes',
        seeds: ['Umbrella barrel — its surface is defined by what `@sigx/lynx-core` re-exports; audit the two together.'],
    },
    'lynx-core': {
        group: 'foundation',
        demo: 'no',
        seeds: [
            'Owns every shared helper the conventions depend on — `callAsync`, `PermissionResponse`, `createLogger`, and (after #860) `subscribeNative` / `unwrapNative` / `SigxError`.',
            'Installs a console transport at import time (`src/index.ts`) but declares no `sideEffects` in package.json (D2.4).',
            '`getConstants` is declared in `signalx-module.json` but never called (C12).',
            'Two of the sixteen duplicate emitter shims live here: `src/app-state.ts`, `src/font-scale.ts`.',
        ],
    },
    'lynx-runtime': {
        group: 'foundation',
        demo: 'yes',
        seeds: [
            'Folds in `@sigx/lynx-runtime-internal` — the shared BG↔MT wire types, which have **zero tests**.',
            'The BG↔MT op protocol spans runtime, runtime-internal and runtime-main; auditing the wire format in isolation is meaningless.',
        ],
    },
    'lynx-runtime-main': { group: 'foundation', demo: 'yes', seeds: ['The only package in the repo that sets `sideEffects` — check the other 56 against its reasoning (D2.4).'] },
    'lynx-plugin': {
        group: 'foundation',
        demo: 'exempt',
        why: 'Build-time Rspack/Rspeedy plugin — no runtime surface to demo; the showcase exercises it by building at all.',
        seeds: ['Highest `any` / `@ts-ignore` density in the repo after lynx-runtime (D2.1).'],
    },
    'lynx-cli': {
        group: 'foundation',
        demo: 'exempt',
        why: 'CLI and autolinker — exercised by every `sigx run:*`, not by a screen.',
        seeds: [
            '`signalx-module.json` `ios.methods` is serialized at `src/autolink/ios.ts:223` into a generated `register()` whose `methods: [String]` parameter is never read (`:488-497`) — dead metadata that has already drifted four times (C12).',
            'Decide in this issue: enforce the field (via the #860 checker) or delete it.',
        ],
    },
    'lynx-web-host': {
        group: 'foundation',
        demo: 'exempt',
        why: 'Host-page bridge — it *is* the web target, exercised by `sigx run:web` rather than by a screen.',
        seeds: ['Declares a structural duplicate of core\'s `PermissionResponse` as `HostPermissionResponse` (`src/host.ts:401-407`) — free to drift (C6).'],
    },

    // --- Native capability modules -------------------------------------------
    'lynx-appearance': {
        group: 'native',
        demo: 'yes',
        seeds: [
            'Exports a **bare** `isAvailable()` at package root (`src/index.ts:31` → `src/setters.ts:85`) — collides with `lynx-sqlite`\'s under a barrel import (C2).',
            'Returns `{ ok: false, reason: \'unsupported\' }` when unlinked instead of throwing (`src/setters.ts:24`) — C3 opt-out that is not documented as one.',
            '`getColorScheme` declared in the manifest, never called (C12).',
            '`setNavigationBarStyle({ style, color? })` takes an object while its sibling `setStatusBarStyle(style)` is positional (C9).',
            '`useSystemColorScheme` returns a bespoke `ColorSchemeRead` rather than `Computed` (C8).',
        ],
    },
    'lynx-audio': {
        group: 'native',
        peer: 'expo-av / expo-audio',
        demo: 'yes',
        seeds: [
            '**Zero tests** — 291 lines with two handle types (`AudioHandle`, `RecordingHandle`) that both own subscriptions and native resources (D3.3).',
            'Three unwrap styles in one package: `unwrapVoid` (`src/handles.ts:58`) and inline `if (r?.error) throw` (`src/audio.ts:70`) (C4).',
            'Error prefix is `[lynx-audio]`, not the scoped `[@sigx/lynx-audio]` (C10).',
        ],
    },
    'lynx-background': {
        group: 'native',
        peer: 'expo-background-fetch / expo-task-manager',
        demo: 'yes',
        seeds: [
            'Module-level `dispatcherSubscription` singleton (`src/background.ts:31`) — verify it survives HMR / double module evaluation (D3.4).',
            '`console.warn` tagged `[background]` rather than `createLogger` (C10).',
        ],
    },
    'lynx-biometric': {
        group: 'native',
        peer: 'expo-local-authentication',
        demo: 'yes',
        seeds: [
            '**C2, the headline violation.** `isAvailable()` returns `Promise<BiometricAvailability>` (`src/biometric.ts:88`) — it asks "is the hardware enrolled?", not "is the module linked?" — so the module check had to be renamed `isModuleAvailable()` (`:131`). Fix shape: `isAvailable(): boolean` + `getCapability(): Promise<BiometricCapability>`.',
            'Returns `{ success: false, errorCode }` when unlinked rather than throwing (`src/biometric.ts:111`) — C3 opt-out needing documentation, or removal.',
        ],
    },
    'lynx-camera': {
        group: 'native',
        peer: 'expo-camera / react-native-vision-camera',
        demo: 'yes',
        seeds: [
            'System-intent only — no preview view, no torch or zoom; `maxWidth`/`maxHeight` are documented as "Reserved — not yet applied" (D1.6, D4).',
            '`settleCapture` (`src/camera.ts:75-113`) is one of five bespoke unwrap helpers; migrate to core\'s `unwrapNative` (C4).',
            '`throw new Error(r.error)` at `src/camera.ts:105` rethrows the raw native string with no package prefix (C10).',
        ],
    },
    'lynx-clipboard': {
        group: 'native',
        peer: 'expo-clipboard / @react-native-clipboard/clipboard',
        demo: 'no',
        seeds: [
            'No showcase screen (D7.6).',
            'Text only — no image or URL clipboard, no `addClipboardListener` (D4).',
            '`setString` is fire-and-forget: failures are invisible to the caller.',
        ],
    },
    'lynx-datetime-picker': {
        group: 'native',
        peer: '@react-native-community/datetimepicker',
        demo: 'yes',
        seeds: [
            '**Live bug.** `src/datetime-picker.ts:136` is `.catch(() => ({ cancelled: true }))` — a bridge failure, a native crash and the user tapping Cancel are indistinguishable to the caller (C3, C5).',
            'Also returns `{ cancelled: true }` when the module is unlinked (`:131-132`), and renames the module check to `isModuleAvailable()` (`:163`) (C2).',
        ],
    },
    'lynx-file-picker': {
        group: 'native',
        peer: 'expo-document-picker',
        demo: 'yes',
        seeds: [
            'Normalizes both `cancelled` and `canceled` from native (`src/file-picker.ts`) — keep the normalization, expose one spelling (C5).',
            'Needs no runtime permission (SAF / `UIDocumentPicker`); say so in the README Gotchas rather than staying silent (C6).',
        ],
    },
    'lynx-file-system': {
        group: 'native',
        peer: 'expo-file-system',
        demo: 'yes',
        seeds: [
            '**Zero tests** (D7.2).',
            'No `mkdir` / `readDirectory` / `copy` / `move` / `downloadAsync` / free-space query (D4).',
            'No streaming — the README already flags the base64 memory blow-up, and `src/file-system.ts:33-40` documents the 33% transfer penalty (D5.2).',
        ],
    },
    'lynx-haptics': {
        group: 'native',
        peer: 'expo-haptics',
        demo: 'yes',
        seeds: [
            '`diagnose` is called from JS (`src/haptics.ts:70`) and implemented in Swift, but absent from `signalx-module.json` (C12).',
            'The silent-no-op-when-unlinked contract (`src/haptics.ts:41-53`) is **correct and well reasoned** — a throw would abort the caller\'s press handler. Make sure the reasoning is in the README too, since C3 requires both.',
            'No custom vibration patterns (D4).',
            '`[D]` needs a real device — simulators don\'t vibrate.',
        ],
    },
    'lynx-http': {
        group: 'native',
        peer: 'WHATWG fetch',
        demo: 'yes',
        seeds: [
            'WHATWG mirror — **exempt from C1**; confirm the exemption is documented in the README.',
            'Patches five globals at import time but declares no `sideEffects` (D2.4, D5.3).',
            'One of the four `createLogger` consumers — the pattern the other 53 packages should copy (C10).',
            '`HttpTaskStore` growth is unbounded until proven otherwise (D3.6).',
        ],
    },
    'lynx-image-picker': {
        group: 'native',
        peer: 'expo-image-picker',
        demo: 'yes',
        seeds: ['`src/image-picker.ts:78` normalizes both `cancelled` and `canceled` from native — correct at the boundary; make sure the public type exposes only one (C5).'],
    },
    'lynx-linking': {
        group: 'native',
        peer: 'expo-linking',
        demo: 'no',
        seeds: [
            'The only `{ remove(): void }` disposers left (`src/inbound.ts:20,53`, `src/back-handler.ts:7`) — `lynx-navigation` has to special-case them per call site (C7).',
            'Three of the sixteen duplicate emitter shims live here.',
            'No showcase screen, though the showcase already declares `scheme: \'showcase\'` (D7.6).',
            'Mixes namespaces (`Linking`, `BackHandler`) with free functions (`parse`, `createURL`) (C1).',
        ],
    },
    'lynx-location': {
        group: 'native',
        peer: 'expo-location',
        demo: 'yes',
        seeds: ['No `watchPosition`, no `getLastKnownPosition`, no reverse geocoding, no background location (D4).'],
    },
    'lynx-maps': { group: 'native', peer: 'react-native-maps', demo: 'yes', seeds: ['Android needs `GOOGLE_MAPS_API_KEY` — check the failure path is legible when it\'s missing (D7.7).'] },
    'lynx-network': {
        group: 'native',
        peer: '@react-native-community/netinfo, navigator.onLine',
        demo: 'no',
        seeds: [
            '**No change subscription at all** — `src/network.ts` exports only `getState()`, yet the README markets it as the `navigator.onLine` analog, and `onLine` has `online`/`offline` events (D4).',
            'No showcase screen (D7.6).',
        ],
    },
    'lynx-notifications': {
        group: 'native',
        peer: 'expo-notifications',
        demo: 'yes',
        seeds: [
            'Categories and actions unshipped — `src/push.ts:33-47` documents `actionIdentifier` as always `\'default\'` (D4).',
            'Two of the sixteen duplicate emitter shims (`src/push.ts`, `src/notifications.web.ts`) (C7).',
            '`src/push.ts:104` is the reference for the string-or-object payload defence (D1.3) — the shape #342 fixed.',
        ],
    },
    'lynx-permissions': {
        group: 'native',
        peer: 'expo-permissions / react-native-permissions',
        demo: 'exempt',
        why: 'Currently has no JS surface to demo; revisit if this issue decides to ship the cross-platform request API.',
        seeds: [
            '**Zero JS surface** — `src/index.ts:19` is `export {}` — yet the package is published with a full README and a docs-site homepage.',
            'Its README says a cross-platform `permissions.request(\'camera\')` API "goes here" if it lands. **This issue decides whether it does.** Sequence it last, after camera / audio / location / notifications have surfaced their real permission needs.',
            'Zero tests. Owns the Kotlin `PermissionHelper` shared by the Android modules.',
        ],
    },
    'lynx-safe-area': { group: 'native', demo: 'yes', seeds: ['`useSafeAreaInsets` returns a bespoke `InsetsRead` rather than `Computed` (C8).', 'One of the sixteen duplicate emitter shims (`src/provider.tsx`) (C7).'] },
    'lynx-secure-storage': {
        group: 'native',
        peer: 'expo-secure-store',
        demo: 'yes',
        seeds: [
            '**Naming conflict with `@sigx/lynx-storage`**: `set`/`get`/`delete` here vs `setItem`/`getItem`/`removeItem` there, for the same concept (C6.3). One agent takes both issues and resolves it in one PR.',
            '`unwrap(result, action)` (`src/secure-storage.ts:44-50`) is the closest existing thing to core\'s `unwrapNative` — good prior art to migrate from (C4).',
            'No key enumeration, no access-group / iCloud-sync flags (D4).',
        ],
    },
    'lynx-share': {
        group: 'native',
        peer: 'React Native Share',
        demo: 'yes',
        seeds: [
            '`Share.share()` returns `void` — the caller cannot tell "shared" from "dismissed", and files can\'t be shared at all (D4).',
        ],
    },
    'lynx-sqlite': {
        group: 'native',
        peer: 'expo-sqlite',
        demo: 'yes',
        seeds: [
            'Exports a **bare** `isAvailable()` at package root (`src/index.ts:1` → `src/sqlite.ts:297`) — collides with `lynx-appearance`\'s under a barrel import (C2).',
            '`SQLiteDatabase` owns a native handle — verify close releases it and post-close calls fail predictably (D3.3).',
            'No `## 📚 Documentation` section in the README (C11).',
        ],
    },
    'lynx-storage': {
        group: 'native',
        peer: '@react-native-async-storage/async-storage, localStorage',
        demo: 'yes',
        seeds: [
            '**Naming conflict with `@sigx/lynx-secure-storage`** — see that issue; resolve both in one PR (C6.3).',
            '`setItem` / `removeItem` / `clear` are fire-and-forget `void`, so write failures are invisible (D1.2, D4).',
            'No `multiGet` / `multiSet` / `multiRemove` / `mergeItem`; `getAllKeys` exists but no `getAllItems` (D4, D5.1 — batching is a bridge round-trip win).',
        ],
    },
    'lynx-video': {
        group: 'native',
        peer: 'expo-video / react-native-video',
        demo: 'yes',
        seeds: ['**Zero tests** (D7.2).', 'View component (`uiComponents` / `behaviors`) rather than a method module — the rubric\'s bridge items apply differently; say so in the audit.'],
    },
    'lynx-webauth': {
        group: 'native',
        peer: 'expo-auth-session / expo-web-browser',
        demo: 'no',
        seeds: [
            'The lone `canceled` speller (`src/webauth.ts:54-56`) — everything else uses `cancelled` (C5).',
            'Returns `{ error: string }` when unlinked (`src/webauth.ts:104`) rather than throwing (C3).',
            '`openAuthSession(authorizeUrl, callbackScheme, options)` has two configuration positionals (C9).',
            'No showcase screen — `AuthDemo.tsx` is biometric + secure-storage, not webauth (D7.6).',
        ],
    },
    'lynx-webrtc': {
        group: 'native',
        peer: 'W3C WebRTC',
        demo: 'yes',
        seeds: [
            'W3C mirror — **exempt from C1**, but it also exposes a `WebRTC` namespace for audio routing (`src/audio-output.ts`); document which half is which.',
            'Implements the permission pair (`src/audio-output.ts:22`) but does not re-export `PermissionResponse` from the barrel (C6).',
            '`RTCPeerConnection` owns native resources — verify teardown and post-close behaviour (D3.3).',
            'Recent R8 stripping bug (#854, fixed in #855) — check the release-build path is covered.',
        ],
    },
    'lynx-websocket': {
        group: 'native',
        peer: 'WHATWG WebSocket',
        demo: 'no',
        seeds: [
            'WHATWG mirror — **exempt from C1**; confirm the exemption is documented.',
            'No showcase screen (D7.6).',
            'Id counter growth is unbounded until proven otherwise (D3.6); `WebSocket` owns a native handle (D3.3).',
        ],
    },
    'lynx-webview': {
        group: 'native',
        peer: 'react-native-webview',
        demo: 'yes',
        seeds: [
            'Check nav-state events, `injectedJavaScriptBeforeContentLoaded`, and cookie APIs against the peer (D4).',
            'The JS-bridge surface deserves a security-flavoured pass — what can page content reach?',
        ],
    },

    // --- UI & interaction -----------------------------------------------------
    'lynx-icons': {
        group: 'ui',
        demo: 'yes',
        seeds: ['Folds in `@sigx/lynx-icons-fa-free` and `@sigx/lynx-icons-lucide` — two-file adapters over `defineIconSet`.', 'The interesting surface is build-time subsetting, which spans `lynx-icons` and `lynx-plugin/src/icons.ts` (D5.4).'],
    },
    'lynx-emoji': {
        group: 'ui',
        demo: 'yes',
        seeds: ['`src/state/persistence.ts:16-25` reaches into `lynx-storage` through a duck-typed `isAvailable()` shim — the C2 fix will touch it.'],
    },
    'lynx-keyboard': { group: 'ui', demo: 'yes', seeds: ['Uses the `*SV` suffix (`useKeyboardLiftSV`) while appearance/safe-area/core use `*MT` — C8 keeps both, for different return types; verify each is correct here.'] },
    'lynx-markdown': { group: 'ui', demo: 'yes', seeds: ['Streaming renderer — D5 (per-token cost) matters more here than in most packages.'] },
    'lynx-richtext': { group: 'ui', demo: 'yes', seeds: ['Custom native element with a web implementation (#771/#773) — D1.9 and D7.8 both apply.'] },
    'lynx-list': {
        group: 'ui',
        demo: 'yes',
        seeds: [
            'Open `TODO(device-verify)` at `src/methods.ts:28` — resolve it or convert it to a tracked issue (D1.10).',
            'Perf-critical recycler: D5.8 (benchmark) and D5.9 (60fps on device) are the load-bearing items. Never grade from a dev build.',
        ],
    },
    'lynx-sheet': {
        group: 'ui',
        demo: 'yes',
        seeds: [
            '**Worst barrel leak in the repo** (D2.6): `src/index.ts` exports `MIN_DISTANCE`, `MAX_EPS_PX`, `OWNER_UNDECIDED`, `PROJECTION_SEC`, `decideDragOwner`, `projectReveal`, `createSheetPan`, `useSheetEngine`.',
            'No `## 📚 Documentation` or `## Install` section in the README (C11).',
        ],
    },
    'lynx-navigation': {
        group: 'ui',
        demo: 'yes',
        seeds: [
            'The reference package — its `__tests__/public-surface.test.ts` is the template every other package copies for D7.1, and its `__tests__/navigation.bench.ts` is the only benchmark in the repo (D5.8).',
            '`useSheetHeight()` returns a `SharedValue` with no `SV` suffix (`src/hooks/use-sheet-height.ts:30`) (C8).',
            'Special-cases `lynx-linking`\'s `{ remove() }` disposers per call site — that goes away with C7.',
        ],
    },
    'lynx-gestures': { group: 'ui', demo: 'yes', seeds: ['Frame-critical: D5.5 (worklet placement) and D5.9 (60fps on device) are the load-bearing items.'] },
    'lynx-motion': { group: 'ui', demo: 'yes', seeds: ['Frame-critical: D5.5 and D5.9 are the load-bearing items.'] },

    // --- Delivery & tooling ---------------------------------------------------
    'lynx-updates': {
        group: 'delivery',
        peer: 'expo-updates',
        demo: 'no',
        seeds: [
            'Folds in `@sigx/lynx-updates-publisher` — the CI-side counterpart of the same manifest format.',
            'Owns the only typed error in the repo, `UpdatesError` / `UpdatesErrorCode` (`src/types.ts:216`) — the model for core\'s `SigxError` (C10).',
            '`getState` and `getCurrentUpdate` declared in the manifest, never called (C12).',
            'No showcase screen (D7.6). No `## 📚 Documentation` section (C11).',
        ],
    },
    'lynx-updates-ui': { group: 'delivery', demo: 'no', seeds: ['No showcase screen (D7.6) — the OTA prompt/progress/banner UI is exactly the kind of thing that needs a demo to be reviewable.'] },
    'lynx-dev-client': { group: 'delivery', demo: 'exempt', why: 'Dev-only client with a Release stub — exercised by `sigx dev`, not by a showcase screen.', seeds: ['`debugOnly` module: verify the Release stub story holds (D1.9).'] },
    'lynx-observability': {
        group: 'delivery',
        demo: 'no',
        seeds: [
            'One of only four `createLogger` consumers — **this issue should define the C10 logging rollout** the other packages adopt.',
            'No showcase screen (D7.6).',
        ],
    },
    'lynx-testing': {
        group: 'delivery',
        demo: 'exempt',
        why: 'Test harness — its demo is the other 52 packages\' test suites.',
        seeds: ['**Sequence first.** Every other package\'s new D1/D3/D7 tests are written against this API, so its gaps become 52 packages\' gaps.'],
    },
};

/**
 * Own-property membership.
 *
 * `in` also walks the prototype chain, so a package directory named
 * `toString` or `constructor` would test as classified and slip past the
 * `unknown` guard — the one check standing between a new package and being
 * silently skipped by the whole campaign.
 */
const has = (map, key) => Object.prototype.hasOwnProperty.call(map, key);

/**
 * Build the audit-unit list from the package directories on disk.
 *
 * Deriving from the filesystem rather than a hardcoded list is what makes the
 * "no package silently dropped" test meaningful — and what makes the generator
 * still correct when a 58th package lands.
 *
 * @param {string[]} packageDirs directory names under `packages/`
 * @returns {{units: Array<{name: string, pkg: string, absorbs: string[], group: string,
 *           peer?: string, demo: string, why?: string, seeds: string[]}>, unknown: string[]}}
 *          `unknown` lists directories in none of META, FOLD or EXCLUDED — a
 *          new package nobody has classified yet. The CLI treats that as an
 *          error rather than quietly skipping it.
 */
export function buildUnits(packageDirs) {
    const dirs = [...packageDirs].sort();
    const unknown = dirs.filter((d) => !has(META, d) && !has(FOLD, d) && !has(EXCLUDED, d));

    const units = dirs
        .filter((d) => !has(FOLD, d) && !has(EXCLUDED, d) && has(META, d))
        .map((d) => ({
            name: `@sigx/${d}`,
            pkg: d,
            absorbs: Object.entries(FOLD)
                .filter(([, into]) => into === d)
                .map(([from]) => `@sigx/${from}`)
                .sort(),
            ...META[d],
            seeds: META[d].seeds ?? [],
        }));

    return { units, unknown };
}

/** Group units for display, preserving GROUPS order. */
export function groupUnits(units) {
    return Object.keys(GROUPS).map((key) => ({
        key,
        title: GROUPS[key],
        units: units.filter((u) => u.group === key),
    }));
}

const RUBRIC_ROWS = [
    ['D1', 'Correctness — every feature works, on iOS, Android and web'],
    ['D2', 'Best practice / code health — types, barrel hygiene, packaging'],
    ['D3', 'Resource lifecycle — disposers, handle teardown, HMR safety, no unbounded growth'],
    ['D4', 'Missing common features vs. the ecosystem peer'],
    ['D5', 'Performance — bridge traffic, import cost, worklet placement, tree-shaking'],
    ['D6', 'API coherence — conforms to C1–C12 or documents an explicit exception'],
    ['D7', 'Demoable, testable, documented — showcase screen, public-surface test, README'],
];

/**
 * Render one audit issue body.
 *
 * The body is the agent's working document, not a brief: it carries the rubric
 * to fill, the `## Findings` section the agent rewrites into a checklist, and
 * the exit criteria that define done. See CONVENTIONS.md Part 3.
 *
 * @param {object} unit a unit from `buildUnits`
 * @param {number} epic the epic issue number
 */
export function renderBody(unit, epic) {
    const lines = [];

    lines.push(`Module review of **${unit.name}**. Part of the epic #${epic}.`);
    if (unit.absorbs.length > 0) {
        lines.push(
            '',
            `Also covers ${unit.absorbs.map((a) => `\`${a}\``).join(' and ')} — ${unit.absorbs.length > 1 ? 'they have' : 'it has'} no standalone surface, so auditing separately would have nothing to decide.`,
        );
    }

    lines.push(
        '',
        '## How to work this issue',
        '',
        'Read [`CONVENTIONS.md`](https://github.com/signalxjs/lynx/blob/main/CONVENTIONS.md) first — Part 1 is the C1–C12 API contract, Part 2 the full rubric, Part 3 the working protocol. In short:',
        '',
        '1. **Audit.** Grade D1–D7. Every item is PASS / FAIL / N-A plus one line of evidence (`file:line`). Post the filled table as a comment.',
        '2. **Write the findings into this issue.** Edit the body, turning every FAIL into a checkbox under `## Findings` — one per concrete defect, not one per dimension.',
        '3. **Work the checklist top-down.** One PR per logical group, following `AGENTS.md`: worktree → `pnpm typecheck` + `pnpm test` → PR with `@copilot` as reviewer → squash merge. **PR bodies say `Part of #<this issue>`, never `Closes`** — this issue stays open as a live status board. Tick the box and comment the PR link as each one merges.',
        '4. **Decide what you can; escalate what you can\'t.** Default to deciding — take the option you\'d recommend and record in the issue what you chose and why. Escalate only when the change is **breaking or user-visible**: a public signature or return type, a breaking rename, UX behaviour, a native dependency, dropping a documented capability, or behaviour that would differ per platform. To escalate, append the question to `## Design questions (blocked)`, add the `needs-decision` label, comment so it notifies, then **carry on with the unblocked items**. (Deciding *not* to ship something *because* it would differ per platform is an ordinary won\'t-do — decide it.)',
        '',
        `\`codecov/patch\` is 80% — every fix carries a test.`,
        '',
        '## Rubric',
        '',
        '| D | Dimension | Result |',
        '|---|---|---|',
        ...RUBRIC_ROWS.map(([d, label]) => `| **${d}** | ${label} | |`),
        '',
        `Items are tagged \`[A]\` automatable · \`[A*]\` automatable once a test exists · \`[D]\` needs a device (iOS **and** Android) · \`[W]\` needs \`sigx run:web\`.`,
    );

    if (unit.peer) {
        lines.push(
            '',
            `**D4 peer to compare against:** \`${unit.peer}\`. Fill the comparison table, triage every gap **ship / defer / won't** with a one-line reason. "Won't" goes in the README Gotchas; "defer" gets a linked follow-up issue.`,
        );
    }

    lines.push('', '**D7.6 showcase:** ');
    if (unit.demo === 'yes') {
        lines.push(
            'a screen exists. Verify it exercises the **failure** paths too — permission denied, module unavailable, cancel — not just the happy path (D7.7), and that it renders on web (D7.8).',
        );
    } else if (unit.demo === 'no') {
        lines.push(
            '**no screen exists — one is owed.** Add it to `examples/showcase`: a screen under `src/screens/`, registered in `src/routes.ts`, listed in `src/catalog.ts` under the right area. It must cover the failure paths, not just the happy path.',
        );
    } else {
        lines.push(`exempt — ${unit.why} Record that reasoning in the audit rather than leaving D7.6 blank.`);
    }

    if (unit.seeds.length > 0) {
        lines.push(
            '',
            '## What the pre-audit already found',
            '',
            'A starting point, not the finding list — still run the full rubric.',
            '',
            ...unit.seeds.map((s) => `- ${s}`),
        );
    }

    lines.push(
        '',
        '## Findings',
        '',
        '_Replace this with one checkbox per defect once the audit is done._',
        '',
        '## Design questions (blocked)',
        '',
        '_None yet._',
        '',
        '## Device verification',
        '',
        '- [ ] iOS — every `[D]` item, on simulator or device',
        '- [ ] Android — every `[D]` item, on emulator or device',
        '- [ ] Web — every `[W]` item, via `sigx run:web`',
        '',
        'Never grade performance from a dev build; dev builds inflate main-thread costs by roughly 300×.',
        '',
        '## Exit criteria',
        '',
        '- [ ] Every finding above is ticked, or deferred to a linked follow-up issue',
        '- [ ] Public-surface freeze test exists and passes (D7.1)',
        '- [ ] README follows the C11 template; the `## Web` section is accurate',
        '- [ ] `pnpm check:conventions` and `pnpm check:manifests` clean for this package — fixing a baselined violation means shrinking the baseline (`--update-baseline`) in the same PR',
        unit.demo === 'exempt'
            ? '- [ ] Showcase exemption recorded with its reason'
            : '- [ ] Showcase screen exists and covers the failure paths',
        '- [ ] Root `CHANGELOG.md` `[Unreleased]` updated',
        '- [ ] Docs-site issue filed on `signalxjs/signalxjs.github.io` for user-facing changes',
    );

    return lines.join('\n');
}

/** The issue title for a unit. */
export function renderTitle(unit) {
    return `Module review: ${unit.name}`;
}
