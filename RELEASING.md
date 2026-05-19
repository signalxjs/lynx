# Releasing

Publishing happens **only** from GitHub Actions via npm Trusted Publishing (OIDC). No `NPM_TOKEN` is stored.

## Versioning: lockstep

All publishable `@sigx/lynx-*` packages share a **single version** — the "Lynx framework version". When we cut a release, every package gets the same new version, regardless of which packages actually changed. This mirrors how Next.js, Storybook, Expo SDK, NestJS, and Remix release.

Why:

- One number for users to reason about. "Lynx 0.4" means a known-good set of `@sigx/lynx-*@0.4.*`.
- Internal `workspace:^` dependencies stay in sync automatically (`pnpm publish` rewrites them on publish).
- Release notes are one document covering everything, not 31.

Guardrails:

- `pnpm version:check` (run in CI before lint/build) fails if package versions diverge.
- `scripts/bump-version.js` refuses to operate on a divergent tree (`--force` to override). Always change versions through the `pnpm version:*` scripts below — never edit `package.json` versions by hand.

## Pre-release checklist

- [ ] `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass on `main`.
- [ ] `pnpm version:check` passes.
- [ ] `pnpm publish:dry` succeeds.
- [ ] `CHANGELOG.md` updated with a new dated section for this version (see "Release notes" below).
- [ ] Each package's `repository`, `homepage`, and `bugs` fields point at `signalxjs/lynx`.
- [ ] `@sigx/lynx-cli` template `package.json` files pin the right `@sigx/*` versions.

## Cutting a release

Only one bump command is supported per release:

```bash
pnpm version:patch          # 0.4.0 → 0.4.1, every package
pnpm version:minor          # 0.4.0 → 0.5.0, every package
pnpm version:major          # 0.4.0 → 1.0.0, every package
pnpm version:set 0.4.0      # explicit, for resets / re-syncs
```

Then:

```bash
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push --follow-tags
```

The `release.yml` workflow runs on the tag, publishes every non-private package to npm with provenance via `scripts/publish.js`, and promotes the Release Drafter draft to a published GitHub Release named `vX.Y.Z`.

## Release notes

We lean on [Release Drafter](.github/release-drafter.yml), which continuously updates a draft GitHub Release as PRs land on `main`. It groups changes by category (🚀 Features / 🐛 Bug Fixes / …) using PR labels auto-applied from Conventional Commit PR titles (`feat(lynx-cli): …`, `fix(lynx-runtime): …` etc — see `CONTRIBUTING.md`).

For each release:

1. Open the [draft release](https://github.com/signalxjs/lynx/releases) on GitHub — it already contains every PR since the last tag, grouped and credited.
2. Copy the body into a new dated section in `CHANGELOG.md` (`## [X.Y.Z] - YYYY-MM-DD`). Polish wording, merge related bullets, surface anything important under a `### Changed (breaking)` heading if applicable.
3. Run `pnpm version:<bump>` and follow "Cutting a release" above.
4. After `release.yml` finishes, `release.yml`'s `github-release` job promotes the Drafter draft (or generates notes via `gh release --generate-notes` as fallback) so the tag has a final GitHub Release.

Because all packages share one version, **there is exactly one `CHANGELOG.md` entry and one GitHub Release per cut** — no per-package changelogs to maintain. Prefix changelog bullets with the affected package name (`@sigx/lynx-cli — …`) so readers can scan by package.

## Publish order

`scripts/publish.js` publishes via `pnpm publish -r`, which orders packages topologically. The de-facto order is:

1. `@sigx/lynx-core`
2. `@sigx/lynx-runtime-internal`
3. `@sigx/lynx-runtime-main`
4. `@sigx/lynx-runtime`
5. `@sigx/lynx-plugin`
6. `@sigx/lynx`
7. `@sigx/lynx-cli`
8. All `@sigx/lynx-*` native modules (alphabetical)
9. `@sigx/lynx-daisyui`
10. `@sigx/lynx-testing`

## Onboarding a new package to npm Trusted Publishing

For each package the **first publish** has to be done manually with an authenticated npm account, then on https://www.npmjs.com/package/<name>/access:

1. Settings → Trusted Publishers → Add a Trusted Publisher.
2. Provider: GitHub Actions.
3. Repository owner: `signalxjs`. Repository: `lynx`. Workflow filename: `release.yml`. Environment: `npm-publish`.

Subsequent publishes happen automatically via OIDC. Tarballs carry npm provenance attestation and the verified publisher badge.

## Dist-tag strategy

Every release lands on `@beta` first, never directly on `@latest`. This lets us:

- Smoke-test with real installs (`npm i pkg@beta`) before users on `@latest` are affected.
- Roll back trivially by republishing the previous version under `@latest` without unpublishing.

Workflow per release:

1. Bump versions (lockstep, see above), tag, push — release workflow publishes under `@beta`.
2. Run smoke tests:
   - `npm create @sigx@beta my-app` (cli repo) — verify scaffolder & generated project boots.
   - For `lynx`: scaffold a Lynx template and run `sigx prebuild && sigx run:android`.
3. Soak ≥ 24 h. Watch for issues.
4. Promote: `npm dist-tag add <pkg>@<version> latest` for each package.
5. Update `CHANGELOG.md`, finalize the GitHub Release.

Patch versions for urgent fixes follow the same path. Pre-release identifiers (`0.4.0-rc.1`) are reserved for breaking changes that deserve broader review.
