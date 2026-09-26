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
- **Tabs draw their indicator themselves.** zero 0.6's `indicator` part
  (a mark over the active tab) positions itself on this platform: it is an
  absolute box over the active tab, measured from the tab's and the list's
  rects (the web's `--tabs-indicator-*` properties are web-only), and the
  skin only paints it. `Tabs.List` renders one on its own, because on lynx
  it is where daisy's active underline lives (the web draws it with a
  `::before`, which lynx drops). Place a `<Tabs.Indicator class="…" />` in
  the list to style or order it; the list then skips its own. Inactive
  panels unmount, so lynx always behaves as the web's `unmountOnExit`.
  The web's `lazyMount`/`unmountOnExit` props are not taken.

  ```tsx
  <Tabs.Root defaultValue="inbox" variant="border" color="primary">
      <Tabs.List>
          <Tabs.Tab value="inbox"><text>Inbox</text></Tabs.Tab>
          <Tabs.Tab value="sent"><text>Sent</text></Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="inbox"><text>…</text></Tabs.Panel>
      <Tabs.Panel value="sent"><text>…</text></Tabs.Panel>
  </Tabs.Root>
  ```
- **Accordion** takes zero 0.6's `orientation` (`vertical` by default,
  stamped on the root and every trigger) and a root-level `disabled`. A
  trigger announces `expanded`/`collapsed` in its accessibility status. The
  web's `loop` and `regions` are keyboard and landmark semantics with no
  lynx surface, so they are not taken.
- **Overlays portal to the outlet.** Wrap the app once in `ZeroRoot` (theme
  host + overlay outlet as the LAST child — stacking is document order).
  Dialog renders the anatomy's `::backdrop` pseudo part as a real view;
  light dismiss routes through the shared layer stack (`dismissTopLayer()`),
  so nested overlays close innermost-first. `Dialog.Close` and
  `Dialog.Cancel` (the alert-style least-destructive action — its own part,
  styled as the quiet member of the pair) and `Popover.Close` take
  `disabled` and an accessible `label`.
- **Anchored popups position in the outlet's own space.** Popover and
  Select measure the anchor, the popup and the outlet together
  (`boundingClientRect`) and flip/clamp against the outlet's box
  (`computeOutletPosition`), so a transform shared by the anchor and the
  outlet — a screen sliding in on a navigation push — cancels out. A popup
  opened at mount (`defaultOpen`) lands where its anchor settles.
- **Press feedback has two tiers.** Every pressable part (Button, a Tabs
  tab, an Accordion trigger, the Popover/Dialog triggers and closes, the
  Select trigger and items, the Toast action and close) is wired through
  `createPressFeedback`. Tier 1 is the `pressed` flag (`zx-f-pressed`),
  which the skin styles. Tier 2, on by default, runs on the main thread:
  touch-down scales the touched element to `PRESSED_SCALE` (0.97) in the
  same frame, with no thread crossing, then hands the flag to the
  background thread. Neither tier fires while the part is disabled. Opt out
  per Button with `pressFeel={false}`, or per custom part with
  `createPressFeedback({ feel: false })`. `feel: { scale, opacity }` tunes
  it; opacity is off by default, because the release has to write an
  explicit `opacity: 1`, which would then hide a skin's disabled fade.
  Tier 2 needs `@sigx/lynx-plugin`'s worklet transform. Without it (unit
  tests), the handlers fall back to tier 1 alone.
- **Button** takes `loading`: it blocks the press like `disabled`, stamps
  the `loading` state (no disabled fade) and renders the anatomy's
  `spinner` part before the label.
- **Toast** follows zero's presence model. A toast is created `closed`,
  flips to `open` a frame later so the skin's entry transition plays, and
  `dismiss(id)` flips it back and removes it after the exit
  (`createToaster({ exitDuration })`, 200 ms by default; `remove(id)`
  skips the exit). A toast can carry `color` and an `action`
  (`{ label, onPress }`), and `Toast.Viewport` takes `size`. The parts
  compose like zero's (`Toast.Root` / `Title` / `Description` / `Action` /
  `Close`). The viewport renders that stock composition, and the parts also
  render in place outside any viewport (they conform inside a viewport
  part, as the gallery draws them).
- **Select is items-driven** over zero's collection core (`items` +
  `itemKey` / `itemLabel` / `itemValue` / `itemGroup`, an `item` slot per
  row; the model is `T | null`, or `V | null` under `itemValue`). The open
  state is a model too (`model:open`, `onOpenChange`; `defaultOpen` seeds
  it). zero 0.6's parts: `clearable` renders a `clear-trigger` beside the
  trigger while something is selected (`clearLabel` names it), and
  `groupSeparators` draws a `separator` between runs of options.
  `readonly` (or the Field's) keeps the value and the popup shut. The
  default glyphs zero's web parts render (`▾`, `✓`, `×`) render as `<text>`
  here — lynx has no pseudo-elements.

  ```tsx
  <Select.Root items={fruits} itemValue={(f) => f.value} itemGroup={(f) => f.group}
      clearable groupSeparators placeholder="Pick a fruit" onValueChange={setFruit} />
  ```
- **Slider is touch-driven tier 1.** The value paints as inline physical
  track percentages (`left`/`width`, or `top`/`height` when vertical), the
  lynx counterpart of the web's runtime `--slider-percent`. A touch maps
  through the track's viewport rect (`boundingClientRect` against the
  touch's `clientX`/`clientY`), so the value lands right on Android, where
  the layout-event rect is not page-relative. It follows zero 0.6: a
  `number[]` model renders one thumb per value (the nearest thumb drags,
  thumbs never cross, `minStepsBetweenThumbs` keeps them apart);
  `orientation="vertical"` runs bottom-to-top; `readonly` refuses every
  touch; `valueCommit` fires once when a drag that moved the value ends.
  Handlers are typed by the model's shape:

  ```tsx
  <Slider.Root defaultValue={40} marks={[0, 50, 100]} onValueChange={(v: number) => {}} />
  <Slider.Root defaultValue={[20, 80]} onValueCommit={(v: number[]) => save(v)} />
  <Slider.Root orientation="vertical" defaultValue={60} showValue />
  ```
- **Switch** takes `readonly` (the prop or the enclosing Field's): a tap
  never toggles it and it shows no press. Readonly Switch and Slider are
  still accessibility elements, with "read only" in their accessibility
  status (a readonly slider drops the `adjustable` trait).
- **Progress** follows zero 0.6's value model: `min`/`max`, where 100% of
  the range is `complete` and a degenerate range with a value reads as
  done. An indeterminate range gets no inline width, so the skin's rule
  sizes and sweeps it. `Progress.ValueText` with no children shows the
  formatted value, and the root's accessibility label announces the same
  string. The formatted value is `getValueText(value, { min, max, percent })`
  when you pass it, otherwise the whole percent (`Intl.NumberFormat` with
  `locale`/`formatOptions` where the engine has `Intl`).
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
  flags included), so it reaches every pilot component. That includes
  Toast: its viewport carries the forcing across the portal to the cards
  in the overlay outlet. The showcase's state-matrix gallery
  (`/zero-gallery`) is built on it.

## What comes next

The compiled design-system shells (`@sigx/lynx-zero-daisyui`) and the
showcase pilot screens land in the remaining PRs of #1029.
