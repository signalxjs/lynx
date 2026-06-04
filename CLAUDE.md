# Claude Code guide (sigx standard)

@AGENTS.md

The imported `AGENTS.md` above is the canonical, tool-neutral guide — workflow,
build/test, packages, conventions, and the git-worktree flow all live there.
Below are only the Claude-Code-specific bits.

## Claude Code specifics

- **Branch first — never work on `main`.** Before touching any file:
  `pnpm wt new <N-short-slug>`, then continue from `<repo>/branches/<name>`.
  Verify with `git branch --show-current` before every commit; if it prints
  `main`, stop — move the changes (`git stash -u` → worktree → `git stash pop`)
  instead of committing. See the warning at the top of `AGENTS.md`.
- **Worktrees**: Claude Code sessions are per-directory, so `pnpm wt new <name>`
  plus launching Claude Code from `<repo>/branches/<name>` gives a fully
  independent parallel session — no extra wiring needed.
