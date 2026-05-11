# Changelog

All notable changes to this repository are documented here. Per-package changelogs live in each `packages/*/CHANGELOG.md`.

## [Unreleased]

### Added

- Initial extraction of `@sigx/lynx*`, `@sigx/lynx-runtime*`, `@sigx/lynx-cli`, and `@sigx/lynx-testing` from `signalxjs/core` into a dedicated repository.
- `@sigx/lynx` un-privatized: first publishable build with `index`, `jsx-runtime`, and `jsx-dev-runtime` entry points.
- `@sigx/lynx-daisyui` un-privatized: first publishable build with shared CSS asset copy.
- Renamed all packages to the Expo-style `@sigx/lynx-*` prefix:
  - `@sigx/runtime-lynx[-internal/-main]` → `@sigx/lynx-runtime[-internal/-main]`
  - `@sigx/testing-lynx` → `@sigx/lynx-testing`
- Native modules (`@sigx/lynx-{camera,clipboard,device-info,file-system,haptics,image-picker,linking,location,network,notifications,permissions,safe-area,share,storage}`) now ship `sigx-module.json` for `@sigx/lynx-cli` auto-linking.
- npm Trusted Publishing (OIDC) release workflow.
- `RELEASING.md` with dist-tag strategy (publish to `@beta` first, soak, promote to `@latest`).

### Deferred

- `@sigx/lynx-navigation` remains private in v0.1: depends on the unreleased `@sigx/motion`. Will ship in a follow-up release.
