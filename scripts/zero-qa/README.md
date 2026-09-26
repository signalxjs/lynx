# zero-qa — tap-free visual QA for lynx-zero

Tooling for the zero fidelity campaign (#1140). It screenshots the showcase's
**state-matrix gallery** on the iOS simulator and builds a contact sheet from
the shots. Nothing here needs a tap.

The gallery is at `examples/showcase/src/screens/zero/gallery/`. It shows every
axis value of a scope against every interaction state, one screen per
**section**. A section is one axis (`color`, `size`, `variant`), a page of one
(`color-1`, `color-2`), or an extra such as `open` for overlays. Held and
focus states are forced with `ForceStates` from `@sigx/lynx-zero/testing`.

## Once per session

```sh
# 1. Take the simulator. There is one, and every QA agent shares it.
node scripts/zero-qa/sim-lock.mjs acquire --holder <you>

# 2. Start ONE dev server from your checkout. Check which process owns the port.
cd examples/showcase && npx sigx dev --ios --no-ui --port 8788 &
lsof -nP -iTCP:8788 -sTCP:LISTEN            # the owning process's cwd must be your checkout
```

The installed app must be a **debug** showcase build that includes the
deep-link host fix (`.onOpenURL` in `ios/showcase/App.swift`, #1141).
`sigx dev --ios` builds one. For an older `ios/` directory, run
`rm -rf examples/showcase/ios` and let prebuild regenerate it.

## Shoot

```sh
node scripts/zero-qa/shoot.mjs --scope button,switch --holder <you> \
  --dev-url http://localhost:8788/main.lynx.bundle      # --dev-url: first run only
node scripts/zero-qa/shoot.mjs --scope select/open,tabs/variant --theme dark --run my-run
```

- A **target** is either a whole scope, which shoots every section in its
  registry entry, or one section written as `scope/section`.
- For each section, shoot cold-launches the app with
  `showcase://zero-gallery/<scope>/<section>[?theme=…]` (`simctl terminate` +
  `simctl openurl`), then waits for the screen to settle. It never waits with
  a bare sleep: consecutive frames must match within a tolerance, and the page
  must have content, so the loading spinner alone doesn't count. It saves the
  shot plus `--bands` (default 3) zoomed horizontal crops.
- Output goes to `.zero-qa/<run>/<scope>/<section>.png` and
  `<section>.bandN.png`, and each run gets a `run.json` manifest. `.zero-qa/`
  is gitignored. A shot that never settled is flagged in the log and on the
  contact sheet.
- `--dev-url` sets the dev URL the app remembers. A cold launch through
  `openurl` has no launch arguments, so the dev client reconnects to its
  **last** URL. If that URL belongs to another checkout's server, you are
  shooting the wrong bundle.
- If the lock is free, shoot takes it for the length of the run. If you already
  hold it, shoot proceeds. If someone else holds it, shoot refuses to run.

To deep-link by hand:
`xcrun simctl openurl booted showcase://zero-gallery/button/color`. To open the
index page instead, use `showcase://zero-gallery`.

## Web reference and contact sheet

```sh
node scripts/zero-qa/web-ref.mjs --scope button,switch --run-dir .zero-qa/<run>
node scripts/zero-qa/sheet.mjs .zero-qa/<run>          # → .zero-qa/<run>/index.html (images inlined)
node scripts/zero-qa/sheet.mjs .zero-qa/<run> --link   # smaller; references the PNGs relatively
```

`web-ref.mjs` needs a zero checkout, found at `<sigx>/zero/main` by default.
Point it elsewhere with `--zero <path>` or `ZERO_REPO`. It also needs the
checkout's build output (`pnpm build` at its root) and zero's Playwright
browsers. The script:

1. boots zero's playground with vite on `--port` (default 5299);
2. pins the design system (`--ds`, default `daisyui`);
3. shoots `/#/<scope>` at iPhone geometry (402pt wide, 3x).

The playground pages are demos, not the axis × state matrix, so the web shot
shows what the skin looks like. It is not a pixel twin of a lynx section.

## Release the simulator

```sh
node scripts/zero-qa/sim-lock.mjs release --holder <you>
node scripts/zero-qa/sim-lock.mjs status                  # exit 0 = free, 1 = held
```

The lock is a directory at `$TMPDIR/sigx-ios-sim.lock`, created with
`mkdir` so that taking it is atomic. It holds an `owner.json` file.
`acquire --force` takes over a lock only if it is **stale**, meaning older
than `--stale-min` (default 120 minutes). It never takes a fresh one.

## Adding a scope

1. Add an entry to `GALLERY_SCOPES` in `gallery/scopes.ts`. The entry lists the
   scope's axis values (from the daisy manifest), its states, and its
   `extras`. Optional fields are `cellWidth`, `rowsPerPage` and
   `settleTolerance`; raise the last one for a perpetual animation.
2. Add the scope's render function to `RENDER` in `gallery/ZeroGallery.tsx`.
   The TypeScript types require one render function per scope.

`shoot.mjs` imports `scopes.ts` directly through Node's type stripping, which
needs Node 22.18 or later. Keep that file free of imports, and use only TS
syntax that Node can erase.

## Limitations

- iOS only. An Android lane would use `adb exec-out screencap` plus an
  `am start -a VIEW -d showcase://…` intent.
- Toast cards mount in the overlay outlet, outside the `ForceStates` tree, so
  their close-button states cannot be forced.
- Anchored popups opened at mount (`popover/open`, `select/open`) can render
  off-screen. That is a lynx-zero positioning bug the gallery exposed, not a
  bug in this tooling.
