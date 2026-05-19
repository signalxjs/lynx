# Contributing

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Node 22+, pnpm 10+. For native builds you'll need Xcode 15+ (iOS) and Android Studio + SDK 34+.

## Working against a sibling `signalxjs/core` checkout

While SignalX is pre-1.0, this repo often needs to be tested against an unreleased `signalxjs/core` build. Use pnpm overrides:

```yaml
# pnpm-workspace.yaml (locally — don't commit)
overrides:
  "@sigx/runtime-core": "link:../../core/packages/runtime-core"
  "@sigx/reactivity": "link:../../core/packages/reactivity"
```

Adjust the relative path to your local layout. Run `pnpm install` to relink.

## Conventions

- Style follows `signalxjs/core`. Lint with `pnpm lint`.
- Native modules: keep the JS surface small, push platform code into `ios/` and `android/`.
- Each package owns its own `README.md`. User-visible changes go in the root [`CHANGELOG.md`](CHANGELOG.md) — there are no per-package changelogs (all `@sigx/lynx-*` packages share one lockstep version, so one entry covers all of them).

## PR titles (Conventional Commits)

PR titles drive both auto-labeling and the auto-generated GitHub Release notes via [Release Drafter](.github/release-drafter.yml). Use:

```
<type>(<scope>): short imperative summary
```

- **type** — one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`.
- **scope** — the package short name, e.g. `lynx-cli`, `lynx-runtime`, `lynx-camera`. Use `lynx` for cross-cutting changes.
- **`!`** after the scope marks a breaking change: `feat(lynx-cli)!: rename config file`.

Examples:

```
feat(lynx-cli): auto-launch most-recent AVD when no Android device connected
fix(lynx-runtime): debounce HMR reload to avoid double-mount
chore(lynx-icons): bump Lucide source set to 0.300
feat(lynx)!: drop legacy createApp signature
```

In the rendered release notes these show up grouped by category (Features / Bug Fixes / …) with the scope lifted to a bold label, e.g. `- **lynx-cli:** auto-launch most-recent AVD … (#123) @user`.

## Filing issues / PRs

- Issues: https://github.com/signalxjs/lynx/issues

## Cross-repo dev workflow

This repo's packages depend on a few `@sigx/*` libraries that live in the [`signalxjs/core`](https://github.com/signalxjs/core) and [`signalxjs/cli`](https://github.com/signalxjs/cli) repos:

- `@sigx/reactivity`, `@sigx/runtime-core`, `@sigx/router`, `@sigx/vite`, `@sigx/terminal`, `sigx` — published to npm; consumed via semver ranges.
- `@sigx/cli` — **not yet published**. Until cli ships its first release, you need a sibling checkout linked via `pnpm.overrides`.

### Linking against sibling checkouts during development

Clone the sibling repos as siblings:

```
~/dev/signalxjs/
├── core/    # signalxjs/core
├── cli/     # signalxjs/cli
└── lynx/    # this repo
```

Then add overrides to your **local** `package.json` (do not commit — keep them in a `.local` patch or use a personal git worktree):

```jsonc
{
  "pnpm": {
    "overrides": {
      "@sigx/cli":          "link:../../cli/packages/cli",
      "@sigx/reactivity":   "link:../../core/packages/reactivity",
      "@sigx/runtime-core": "link:../../core/packages/runtime-core",
      "@sigx/vite":         "link:../../core/packages/vite",
      "@sigx/terminal":     "link:../../core/packages/terminal"
    }
  }
}
```

Run `pnpm install` to apply. Remove the overrides before committing release commits.

## Testing an unpublished native module in a consumer app

When you're iterating on a new native module (say `@sigx/lynx-websocket`) and want to drive it from a real Lynx app *before* publishing to npm, link the package into the consumer with `pnpm.overrides` and `link:`.

In the **consumer app's** `package.json` (e.g. `~/dev/sigx/my-lynx-app/package.json`):

```jsonc
{
  "dependencies": {
    "@sigx/lynx-websocket": "link:../lynx/main/packages/lynx-websocket"
  },
  "pnpm": {
    "overrides": {
      "@sigx/lynx-websocket": "link:../lynx/main/packages/lynx-websocket",
      // Also override any workspace: deps the linked package pulls in,
      // since `workspace:` doesn't resolve outside a pnpm workspace.
      "@sigx/lynx-core": "link:../lynx/main/packages/lynx-core"
    }
  }
}
```

With the dependency declared above, `sigx prebuild` auto-discovers the package by its `signalx-module.json` and links it — no `signalx.config.ts` edit needed.

Workflow:

```bash
# 1. build the new package (its dist/ is what the consumer reads)
pnpm --filter @sigx/lynx-websocket build

# 2. (one-time per change to package.json) refresh the symlink
cd ~/dev/sigx/my-lynx-app
pnpm install

# 3. regenerate native projects so the autolinker picks up signalx-module.json
pnpm prebuild

# 4. run
pnpm run:android   # or run:ios
```

Tips:

- **TS-only changes:** run `pnpm --filter @sigx/lynx-websocket dev` (tsc --watch) in one terminal. The dev server picks up the rebuilt `dist/` on next reload — no reinstall needed.
- **Native (Swift/Kotlin) changes:** rerun `pnpm prebuild` in the consumer, then rebuild the native app (`pnpm run:android` / open the Xcode project).
- **Don't commit** the consumer-side overrides; they're host-machine-specific paths. Keep them in a local-only patch.
