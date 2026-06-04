# Claude Code guide (sigx standard)

@AGENTS.md

The imported `AGENTS.md` above is the canonical, tool-neutral guide — workflow,
build/test, packages, conventions, and the git-worktree flow all live there.
Below are only the Claude-Code-specific bits.

## Claude Code specifics

- **Worktrees**: Claude Code sessions are per-directory, so `pnpm wt new <name>`
  plus launching Claude Code from `<repo>/branches/<name>` gives a fully
  independent parallel session — no extra wiring needed.
