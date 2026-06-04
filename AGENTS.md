# SignalX for Lynx — shared agent guide

> ⚠️ **BRANCH FIRST — never work on `main`.** Before touching ANY file, create a
> worktree (`pnpm wt new <N-short-slug>`) and do everything from
> `<repo>/branches/<N-short-slug>`. This applies to every change, however small —
> editing or committing in the primary checkout (`<repo>/main`) causes conflicts
> for parallel sessions. Check yourself before every commit:
> `git branch --show-current` must print your worktree's branch name — if it
> prints `main` or nothing (detached HEAD), stop.
> Already edited files in `main` by mistake? Move the work, don't commit it:
> `git stash -u` → `pnpm wt new <N-short-slug>` →
> `cd <repo>/branches/<N-short-slug>` → `git stash pop`.

Canonical guidance for **any** AI agent working in this repo (Claude Code, GitHub
Copilot CLI, work agents, …). Tool-specific notes live in `CLAUDE.md`; it defers
here for everything shared — when it conflicts with this file, the tool-specific
file wins for that tool only.

This is the sigx standard agent setup. The same pattern (this file +
`scripts/worktree.mjs` + a thin tool-specific file) is used across sigx repos —
see "Adopting this setup in another sigx repo" at the bottom.

SignalX for Lynx is a pnpm monorepo (ESM, `"type": "module"`) bringing sigx to
the Lynx mobile runtime — dual-thread rendering (background JS thread + main UI
thread), a CLI/build plugin, gestures, motion, navigation, UI components and
30+ native modules. 40+ workspace packages under `packages/`, published to npm
under the `@sigx` scope as `@sigx/lynx-*`, all **lockstep-versioned** (every
publishable package shares one version). Tech stack: TypeScript (strict),
tsgo, Vitest, oxlint.

## Development workflow (issue → PR → Copilot review → merge)

**This is mandatory for EVERY agent-driven change — including one-line fixes.
Never commit straight to `main`.** Repo: `signalxjs/lynx`, base branch `main`.
(Human contributors may follow looser conventions; for agents the issue-first
flow below is required.)

1. **Issue first.** If no GitHub issue already tracks the work, create one *before*
   writing code and put the plan in it:
   ```sh
   gh issue create --title "<concise title>" --body "<what & why, plus the plan/checklist>"
   ```
   If you worked in plan mode, the approved plan **is** the issue body. Note the
   number it returns (`#N`).

2. **Branch — a worktree is ideal.** Never work on `main`. Use the worktree flow
   (below): `pnpm wt new <N-short-slug>` gives an isolated checkout on branch
   `<N-short-slug>`. (Plain alternative: `git switch -c <N-short-slug>`.)

3. **Implement & verify.** Make the change, then prove it: `pnpm typecheck` (always,
   for any `.ts`) plus the relevant `pnpm test` / `pnpm build`. Stage specific
   files (`git add <path>`), never `git add -A`. No co-author trailers.

4. **Open a PR with Copilot as the reviewer.** Reference the issue so it auto-closes
   on merge:
   ```sh
   gh pr create --base main --title "<title>" \
     --body "Closes #N. <short summary of the change>" --reviewer @copilot
   ```
   (On an already-open PR: `gh pr edit <pr> --add-reviewer @copilot`.) The bot
   `copilot-pull-request-reviewer` posts its review within a minute or two. If your
   `gh` is too old to resolve `@copilot` (error: `'@copilot' not found`), request it
   via the API instead — don't skip it:
   ```sh
   gh api --method POST repos/signalxjs/lynx/pulls/<pr>/requested_reviewers \
     -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
   ```
   (The reviewer-request API takes the `[bot]`-suffixed slug; the review author
   login in `.reviews[].author.login` appears *without* the suffix.)

5. **Wait for Copilot's review, then fix.** Do not merge before it has reviewed. Poll
   until a review by the bot appears, then read it:
   ```sh
   gh pr view <pr> --json reviews -q '.reviews[].author.login'   # wait for "copilot-pull-request-reviewer"
   gh pr view <pr> --json reviews,comments
   ```
   Address every actionable comment with follow-up commits and push. If the review
   doesn't re-trigger on its own, re-request it: `gh pr edit <pr> --add-reviewer @copilot`.
   Repeat until Copilot has no remaining actionable feedback.

6. **Merge it yourself.** Once Copilot's feedback is resolved AND CI is green, merge
   (squash — repo rules block merge commits) and clean up:
   ```sh
   gh pr checks <pr>                          # must be all green first
   gh pr merge <pr> --squash --delete-branch
   ```
   If you used a worktree, remove it afterward: `pnpm wt rm <name>`.

## Build, Test, Lint

```bash
pnpm install
pnpm build         # all packages, recursively (tsgo + asset copy per package)
pnpm test          # vitest run
pnpm test -- packages/lynx-gestures   # single test file/dir (substring match)
pnpm test -- -t "name of test"        # single test by name (vitest -t)
pnpm test:watch
pnpm test:coverage
pnpm typecheck     # tsgo --noEmit + examples typecheck
pnpm lint          # oxlint packages
pnpm lint:fix
pnpm version:check # enforce lockstep versions across publishable packages
pnpm verify:pack   # publish dry-run
```

## Packages

40+ workspace packages under `packages/`, grouped roughly as:

- **Framework / build**: `@sigx/lynx` (umbrella), `@sigx/lynx-plugin`, `@sigx/lynx-cli` (SWC/Rspack transforms, `sigx dev` / `sigx run:android` / `sigx run:ios`).
- **Runtime**: `@sigx/lynx-runtime`, `@sigx/lynx-runtime-main`, `@sigx/lynx-runtime-internal` — the dual-thread renderer.
- **Native modules (30+)**: `@sigx/lynx-<capability>` packages (camera, storage, location, biometric, notifications, websocket, webview, …).
- **UI / motion / gestures**: daisyui, icons (+ adapters), gestures, motion, navigation.
- **Dev / testing**: dev-client, testing.

**Lockstep versioning**: every publishable package shares one version. Never
bump a single package's version — use `pnpm version:patch|minor|major` (and
`pnpm version:check` validates). Publishing is handled by `scripts/publish.js`
in topological order with npm provenance.

## Parallel work with git worktrees

To work two things at once — each with its own checkout and its own agent
session — use a worktree instead of switching branches in place:

```sh
pnpm wt new <name> [--from <branch>]   # worktree at <repo>/branches/<name>: own branch + deps installed
pnpm wt list                           # show all worktrees
pnpm wt rm <name> [--force]            # remove a worktree
```

Layout convention (all sigx repos): the primary checkout lives at `<repo>/main`
and every worktree at `<repo>/branches/<name>`. `pnpm wt new` creates the
checkout there on a new branch `<name>` and runs `pnpm install` (pnpm hardlinks
from the global store — fast). Launch a **separate agent session from the
worktree directory**; sessions stay independent per directory. Names: letters,
digits, `.`, `_`, `-` only.

## Conventions & working principles

- **Plan first for non-trivial work.** Both Claude Code and Copilot CLI have a built-in plan mode; use it and let the CLI manage the plan file.
- **Verify before declaring done.** Run typecheck/tests for code changes; show evidence the change works.
- **Minimal, surgical edits.** Don't refactor unrelated code. Don't add backward-compat shims for things that never shipped.
- **Cross-platform paths**: Contributors and CI run on Windows, macOS and Linux — use the path separator and shell syntax of the environment you're in, and prefer Node scripts over shell one-liners for anything committed to the repo.
- **Git hygiene**: Stage specific files (`git add <path>`), never `git add -A` / `git add .`. Run `pnpm typecheck` before any commit touching `.ts`. Do **not** add co-author trailers to commits (e.g. `Co-Authored-By: Claude …` / `Co-authored-by: Copilot …`).

## Adopting this setup in another sigx repo

This file, `scripts/worktree.mjs`, and `CLAUDE.md` are the portable sigx
standard. To adopt it in another repo:

1. Check the repo out using the standard layout: primary checkout at
   `<repo>/main`, worktrees under `<repo>/branches/`.
2. Copy `scripts/worktree.mjs` and `CLAUDE.md` verbatim; copy this `AGENTS.md` as a template.
3. Add `"wt": "node scripts/worktree.mjs"` to the repo's `package.json` scripts.
4. Adapt the repo-specific sections of `AGENTS.md`: the intro (what the repo is),
   "Build, Test, Lint", and "Packages". In the workflow section, swap the repo
   slug (`signalxjs/lynx`) in the `gh api` fallback.
5. Keep the workflow, worktree, and conventions sections as-is — they are the
   shared standard.
