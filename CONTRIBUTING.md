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
- Each package owns its own `README.md` and `CHANGELOG.md`.

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
