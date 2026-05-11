# Releasing

Publishing happens **only** from GitHub Actions via npm Trusted Publishing (OIDC). No `NPM_TOKEN` is stored.

## Pre-release checklist

- [ ] `pnpm install`, `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` all pass on `main`.
- [ ] `pnpm publish:dry` succeeds.
- [ ] `CHANGELOG.md` entries added.
- [ ] Each package's `repository`, `homepage`, and `bugs` fields point at `signalxjs/lynx`.
- [ ] `@sigx/lynx-cli` template `package.json` files pin the right `@sigx/*` versions.

## Cutting a release

```bash
pnpm version:patch          # or minor / major / explicit
git commit -am "release: vX.Y.Z"
git tag vX.Y.Z
git push --follow-tags
```

The release workflow runs `pnpm publish:all -- --tag beta` first. After ≥1–2 days of soak, promote each package to `latest`:

```bash
npm dist-tag add <pkg>@X.Y.Z latest
```

## Publish order

The publish script publishes packages in dependency order:

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

1. Bump versions, tag, push — release workflow publishes under `@beta`.
2. Run smoke tests:
   - `npm create sigx@beta my-app` (cli repo) — verify scaffolder & generated project boots.
   - For `lynx`: scaffold a Lynx template and run `sigx prebuild && sigx run:android`.
3. Soak ≥ 24 h. Watch for issues.
4. Promote: `npm dist-tag add <pkg>@<version> latest` for each package.
5. Update `CHANGELOG.md`, draft GitHub Release notes.

Patch versions for urgent fixes follow the same path. Pre-release identifiers (`0.1.0-rc.1`) are reserved for breaking changes that deserve broader review.
