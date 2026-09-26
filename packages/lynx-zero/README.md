# @sigx/lynx-zero

Design-system-neutral UI foundation for SignalX Lynx, built on the
[zero contract](https://github.com/signalxjs/zero) — the same anatomies,
vocabularies and token names the web foundation ships, delivered the way
lynx's style engine can consume them. Part of the design-system stack
redesign tracked in
[signalxjs/lynx#1029](https://github.com/signalxjs/lynx/issues/1029); the
pre-contract package lives on as `@sigx/lynx-zero-legacy` until this stack
reaches parity.

## The model

A design system is data. Its recipes live once, in a zero-repo package
(`@sigx/zero-daisyui`, …), and compile per target with `@sigx/zero-kit`:
attribute-selector CSS for the web, **class-grammar CSS for lynx** —
`.zx-<scope>__<part>` compounds with `zx-s-<state>` / `zx-f-<flag>` /
`zx-a-<axis>-<value>` / `zx-m-<mod>` modifiers, every color a baked literal,
themes as full-restatement `.zx-root.zx-theme-<name>` blocks. This package is
the runtime those stylesheets target.

- **`partBag(anatomy, part, options)`** — the render seam. One part
  descriptor yields both halves of the contract: the class list (composed
  with `@sigx/zero`'s grammar helpers — the only thing lynx CSS can select
  on) and the `data-scope`/`data-part`/`data-state`/flag attributes (they
  render fine and stay the machine-readable anatomy for tests and tooling).
  Deriving both from one input is what keeps them from ever disagreeing.
- **`partA11y(options)`** — zero's accessibility guarantees projected onto
  lynx's five-prop native surface (`accessibility-element`/`-label`/
  `-trait`/`-status`), stated on the node that owns the tap handler.
- **The zero contract, re-exported** — vocabularies, token categories,
  `variantAttrs`, the class grammar. This package defines no parallel
  vocabulary; `@sigx/zero` (catalog-pinned beta) is the single source.
- **Axis defaults** — the lynx CSS has no `:not()` default twins, so an
  axis a recipe wires must always resolve to a concrete `zx-a-*` class.
  The design-system shell registers its manifest's declared defaults at
  load (`registerAxisDefaults`, right beside `registerTheme`), and every
  carrier resolves `explicit prop ?? registered default` per scope with
  `resolveVariantAxes` before stamping. No registration means unset axes
  stamp nothing — headless usage is unchanged.
- **Re-carried axes** — a part whose anatomy declares `carries` for a named
  axis (zero's `PartSpec.carries`; Timeline's marker carries `color`) is a
  nearer provider of that axis. With its own value it stamps
  `zx-a-<axis>-<value>` on itself and every part below it; without one it
  passes the carrier's value through — the nearest provider wins, like the
  web compiler's nearest carrier. A component opts a part in with
  `provideCarriedAxes(anatomy, part, () => ({ color: props.color }))` in
  place of `useVariantAxes()`; axes the anatomy does not declare are never
  taken from the part.

## Theming

Theme **values** never travel through JavaScript: the compiled skin declares
every theme as static CSS, so selection is one class swap on the provider's
host view. Theme **metadata** (names, scheme, light/dark pairing) comes from
`@sigx/zero/theme/registry`, seeded by the design-system package at module
load — the same registry the web runtime uses.

```tsx
import { ThemeProvider, useTheme, themeController } from '@sigx/lynx-zero';

defineApp(() => () => (
    <ThemeProvider>          {/* renders class="zx-root zx-theme-<active>" */}
        <App />
    </ThemeProvider>
));

// Headless control from anywhere:
themeController.set('daisy-dark');
themeController.toggle();
themeController.followSystem();
```

- `followSystem` (the default) picks the theme per OS scheme via the shared
  registry; the appearance signal is seeded natively before first paint, so
  the first render is already scheme-correct.
- `setFontScale(n)` re-emits the scalable `--text-*` ramp as scaled literal
  px inline on the host (`registerTextRamp` supplies the unscaled values —
  the design-system package registers them beside its themes).
  `--text-fixed-*` — control chrome — is untouched by construction.
- `useScreenTheme(name)` (`@sigx/lynx-zero/screen-theme`, optional
  `@sigx/lynx-navigation` peer) pins the global theme while a route is
  focused.

## Layout

`Row` / `Col` / `Center` / `Spacer` / `ScrollView` and the responsive-prop
helpers carry over from the legacy package unchanged — lynx-only concerns
(long-form flex because the engine mis-expands the shorthand, JS-resolved
breakpoints because inline styles beat stylesheet `@media`) that zero has no
counterpart for.

## Components (the pilot ten, plus Timeline)

Progress, Button, Switch, Tabs, Accordion, Dialog, Popover, Toast, Select,
Slider — zero's anatomies rendered in Lynx JSX over the shared behaviors —
and Timeline (`Root` / `Item` / `Marker` / `Connector` / `Content`,
vertical by default, `placement="start|end"` on Content). `color` on
`Timeline.Root` colors every marker; `color` on one `Timeline.Marker`
colors that marker alone, and a marker without one follows the root.
The platform spellings to know:

- **Closed means unmounted.** Lynx has no `hidden` attribute and no
  attribute selectors, so inactive panels, closed popups and unchecked
  indicators leave the tree — absence is the lynx spelling of `hiddenIn`.
- **Overlays portal to the outlet.** Wrap the app once in `ZeroRoot` (theme
  host + overlay outlet as the LAST child — stacking is document order).
  Dialog renders the anatomy's `::backdrop` pseudo part as a real view;
  light dismiss routes through the shared layer stack (`dismissTopLayer()`),
  so nested overlays close innermost-first.
- **Select is items-driven** over zero's collection core (`items` +
  `itemKey` / `itemLabel` / `itemValue` / `itemGroup`, an `item` slot per
  row; the model is `T | null`, or `V | null` under `itemValue`;
  `defaultOpen` seeds the popup open); Slider is touch-driven tier 1 — the value
  paints as inline track percentages, the lynx counterpart of the web's
  runtime `--slider-percent`.
- **`@sigx/lynx-zero/testing`** holds components to the same contract as
  the web: `expectAnatomy` (zero's oracle over the rendered tree; pass
  `{ portaled: ['popup'] }` for parts the outlet hosts; a stamped axis is
  checked against its nearest provider — the carrier, or a nearer part that
  declares it `carries` the axis) and
  `expectClassGrammar` (the classes recomputed from the data attributes).
- **Forcing interaction states for display.** `ForceStates` (also from
  `@sigx/lynx-zero/testing`) forces presence-only flags onto every zero
  part below it, so a held press or a focus ring can be rendered — and
  screenshotted — without input:

  ```tsx
  import { ForceStates } from '@sigx/lynx-zero/testing';

  <ForceStates flags={{ pressed: true }}>
      <Button color="primary"><text>Held</text></Button>
  </ForceStates>
  <ForceStates flags={{ 'focus-visible': true }} parts={['control']}>
      <Switch defaultChecked />
  </ForceStates>
  ```

  A flag lands only on parts whose anatomy declares it (`pressed` on a
  switch's `control`, not its root), as both the `zx-f-*` class and the
  `data-*` attribute, so a forced tree still passes both oracles. `parts`
  narrows it further, `false` forces a flag off, and a nearer
  `ForceStates` replaces an outer one — including one nested inside a
  carrier, which keeps that carrier's axes. It rides the axis push-down
  context (`provideVariantAxes` now returns the reader it provides, forced
  flags included), so it reaches every pilot component except Toast, whose
  cards mount in the overlay outlet outside the provider tree. The
  showcase's state-matrix gallery (`/zero-gallery`) is built on it.

## What comes next

The compiled design-system shells (`@sigx/lynx-zero-daisyui`) and the
showcase pilot screens land in the remaining PRs of #1029.
