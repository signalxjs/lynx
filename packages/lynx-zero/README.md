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
- **Skin authors: a `var()` shorthand ignores specificity on lynx.** The
  engine keeps a declaration that holds `var()` under its own property id,
  unexpanded, and expands it only after the cascade has merged every rule,
  in the order the property ids were first seen. A static shorthand is
  expanded into longhands when the stylesheet is parsed. So a var-bearing
  `border`/`border-color`/`padding` and a static longhand of the same edge
  never compete by specificity: the one whose property id first appears
  later in the merged rules wins
  ([#1161](https://github.com/signalxjs/lynx/issues/1161),
  [#1162](https://github.com/signalxjs/lynx/issues/1162)). In a recipe's
  lynx section, write a var-bearing edge as its physical longhands
  (`border-top-color: var(--x)` …): they share one key with any competing
  longhand, so the cascade decides again. A var-bearing longhand such as
  `color: var(--x)` already cascades normally.

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
  Only `px` ramp entries scale. zero-kit's lynx target rewrites `rem` to
  `px` at 16px/rem, because lynx's own `rem` is 14px
  ([#1183](https://github.com/signalxjs/lynx/issues/1183)), so a zero skin's
  rem-based ramp arrives in px.
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
  The outlet is a `position: fixed` layer, mounted once with the page and
  shown only while something is open (it toggles `display`, it is never
  re-inserted): lynx attaches fixed nodes to the page root, so a modal
  backdrop dims the whole screen — status bar and home-indicator strips
  included — even when `ZeroRoot` sits inside a `SafeAreaView`, below a
  navigation header, or in a navigation stack that clips its screens.
- **The outlet passes touches AND pans through.** Two hit-tests matter.
  Lynx's own (taps, `bindtap`) honours `pointer-events`: the layer is
  `none`, and since both engines INHERIT the value, the root of every
  overlay opts back in — a custom overlay rendered through
  `useOverlayPortal()` must spread `OVERLAY_ROOT_STYLE`
  (`pointer-events: auto`) into its root's inline style, or its taps fall
  through to the page. The platform's (iOS UIKit, which is what starts a
  scroll view's pan) ignores `pointer-events`, so the layer is **0×0** with
  `overflow: visible`: it covers no point, while its children still paint
  and hit-test across the window. A full-window layer swallowed every pan
  on iOS while a toast or popover was open. Consequences for a custom
  overlay root:
  - Lynx bounds an absolute child's auto height by its containing block,
    so a content-sized root states `height: 'max-content'`.
  - A root that must cover the window spreads `useOutletFill()` (the
    window's size, known from a childless full-window sizer that is out of
    both hit-tests) instead of `top/right/bottom/left: 0`.
  - A full-window surface that should catch taps but let a pan scroll the
    page sets `native-interaction-enabled={false}` (lynx taps still reach
    it). The native flag covers a view's whole native subtree, so keep
    interactive content a SIBLING of such a surface, never its child.
  Popover and Select light-dismiss through exactly such a surface: a tap
  outside closes them, a pan beside them scrolls the page, as on the web,
  and the popup follows its anchor through the scroll and its fling. A
  Dialog backdrop keeps native hit-testing: a modal holds the pan. Toasts
  block only their own strip.
- **The safe frame.** The host's own box is the **safe frame** content
  respects: the dialog panel centers in it, a toast viewport pins to its
  edges, and `useOverlayInsets()` returns the frame's per-edge insets
  inside the window for a custom overlay. Dialog renders the anatomy's
  `::backdrop` pseudo part as a real view; light dismiss routes through
  the shared layer stack (`dismissTopLayer()`), so nested overlays close
  innermost-first. `Dialog.Close` and `Dialog.Cancel` (the alert-style
  least-destructive action — its own part, styled as the quiet member of
  the pair) and `Popover.Close` take `disabled` and an accessible `label`.
  Popover carries zero 0.6's `description` part (`Popover.Description`,
  the popup's muted body line under `Popover.Title`). Its `arrow` is
  painted by the web target only, and its separate `anchor` part is not
  taken: the popup anchors to `Popover.Trigger`.
- **Anchored popups position in the outlet's own space.** Popover and
  Select measure the anchor, the popup and the safe frame together
  (`boundingClientRect`) and flip/clamp against the safe frame
  (`computeOutletPosition`), so a popup never flips into a status-bar or
  home-indicator strip or under a header. The outlet itself is not
  measured: it sits at the page root's origin with the window's size
  (`fixedOutletRect`). A transform (a screen sliding in on a navigation
  push) fires no layout event, so the anchor and the frame keep
  re-measuring until they hold still inside the window; a frame that pokes
  out of the window counts as still moving. A popup opened at mount
  (`defaultOpen`, a cold deep link) therefore lands at its anchor, not
  clamped against the right edge, and toasts clear the status bar and the
  home indicator from the first frame the slide settles. The outlet does
  not ride a screen transform, so an open popup follows its anchor in
  measured steps while its screen slides. Only an OPEN popup measures: a
  closed trigger takes no measurement and runs no settle loop. Every
  re-measure loop on the page ticks on one shared clock, loops due in the
  same frame measure in one batch, the shared safe frame is measured once
  per batch, and each burst is capped (about two seconds of motion), so a
  screen with dozens of popups costs what one does. A custom overlay built
  on `createAnchorPosition` passes `isOpen` to get the same gating.
- **Press feedback has two tiers.** Every pressable part (Button, a Tabs
  tab, an Accordion trigger, the Popover/Dialog triggers and closes, the
  Select trigger and items, the Toast action and close, a Toggle, each
  ToggleGroup item) is wired through
  `createPressFeedback`. Tier 1 is the `pressed` flag (`zx-f-pressed`),
  which the skin styles. Tier 2, on by default, runs on the main thread:
  touch-down scales the touched element to `PRESSED_SCALE` (0.97) in the
  same frame, with no thread crossing, then hands the flag to the
  background thread. Neither tier fires while the part is disabled. Opt out
  per Button, Toggle or ToggleGroup item with `pressFeel={false}`, or per custom part with
  `createPressFeedback({ feel: false })`. `feel: { scale, opacity }` tunes
  it; opacity is off by default, because the release has to write an
  explicit `opacity: 1`, which would then hide a skin's disabled fade.
  Tier 2 needs `@sigx/lynx-plugin`'s worklet transform. Without it (unit
  tests), the handlers fall back to tier 1 alone.
- **Button** takes `loading`: it blocks the press like `disabled`, stamps
  the `loading` state (no disabled fade) and renders the anatomy's
  `spinner` part before the label.
  With the daisy skin, a button is content-sized and never squeezed, like
  daisy's `btn`. In a row or box narrower than its content, it overflows
  whole instead of breaking its label mid-word
  ([#1165](https://github.com/signalxjs/lynx/issues/1165); the skin side
  is [signalxjs/zero#372](https://github.com/signalxjs/zero/pull/372) and
  arrives with the next zero release). Use `mods={{ block: true }}` (or
  `wide`) for a full-width button.
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
  trigger while something is selected (`clearLabel` names it; it and the
  indicator stamp the root's axes, so a skin can place the × beside the ▾
  at each size — daisy draws it as a 1.5rem chip with an inset focus
  ring). While the clear-trigger renders, the trigger, value and indicator
  also carry zero's `clearable` flag (`zx-f-clearable`, zero#387) — the
  class-grammar form of the web's `:has(> clear-trigger)` — so a skin
  reserves the chip's width and the value clips before it instead of
  running under it. The flag is stamped only on parts the installed zero's
  anatomy declares it for. And
  `groupSeparators` draws a `separator` between runs of options.
  `readonly` (or the Field's) keeps the value and the popup shut. The
  default glyphs zero's web parts render (`▾`, `✓`, `×`) render as `<text>`
  here — lynx has no pseudo-elements. The popup renders in the overlay
  outlet, outside the root, so nothing inherits across the portal: every
  popup part stamps the root's axis classes (a skin re-scopes its accent on
  the popup's own compound), and the popup and each group are flex columns
  (the lynx spelling of the web's block flow) so rows and separators span
  the list.

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
- **Toggle** (zero's `toggle` scope, Wave 2): a button with one bit of
  state. `Toggle.Root` flips `on|off` on a tap; the model concept is
  `pressed` (`model`, `defaultPressed`, `onPressedChange`). It is not a
  form control: Switch owns that case. There is no `aria-pressed` on lynx,
  so the on-state is announced as `selected` on a `button` trait; pass
  `label` for an icon-only toggle. The `pressed` flag (the finger is down)
  and the `on` state (the mode) are independent: a held on-toggle carries
  both. `disabled` (or the Field's) blocks the tap and the press;
  `pressFeel={false}` keeps the flag but drops the main-thread scale.
- **ToggleGroup** (`Root` / `Item`): toggles under one value model. As on
  the web, the model's shape follows `multiple`: a `string` in single mode
  (`''` when none is on), a `string[]` under `multiple`, and the exported
  root is typed by that overload. In single mode, tapping the on item
  turns it off unless `deselectable={false}`. `orientation`
  (`horizontal` by default) and the root's axes are stamped on every item.
  `disabled` on the root disables every item. `invalid` and `required`
  (the props or the Field's) are root flags. There is no keyboard, so no
  roving focus. Lynx has no `:first-child` or `:last-child`, so the root
  tracks its items in mount order and stamps the end items with the
  `first` and `last` modifiers (`zx-m-first` / `zx-m-last`,
  `data-mod-first` / `data-mod-last`). The skin uses them to round the
  join's outer corners on the end items and to drop the first item's
  leading seam. An item mounted later, such as a conditional one, joins
  the end of that order wherever it sits in the row. There is no form, so no
  `hidden-input` part. There is no group role: the root carries no
  accessibility props, because an accessible root would hide its items
  from the reader on iOS. Each item is a `button`, `selected` while on,
  with its own press feedback. An item valued `''` throws in single mode,
  where `''` means "none".

  ```tsx
  <Toggle.Root label="Bold" model={() => state.bold}><text>B</text></Toggle.Root>

  <ToggleGroup.Root model={() => state.align} color="secondary">
      <ToggleGroup.Item value="left"><text>Left</text></ToggleGroup.Item>
      <ToggleGroup.Item value="center"><text>Center</text></ToggleGroup.Item>
  </ToggleGroup.Root>
  <ToggleGroup.Root multiple defaultValue={['bold']} onValueChange={(v: string[]) => save(v)}>
      <ToggleGroup.Item value="bold" label="Bold"><text>B</text></ToggleGroup.Item>
      <ToggleGroup.Item value="italic" label="Italic"><text>I</text></ToggleGroup.Item>
  </ToggleGroup.Root>
  ```
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

## Checkbox, CheckboxGroup, RadioGroup

Zero's `checkbox`, `checkbox-group` and `radio-group` anatomies (#1203).
There are no forms on lynx, so the web's hidden native input (the
`hidden-input` part), `name`/`form` posting and native validity are not
taken: state is the controllable model, each row is its own tap target and
accessibility element (trait `button`, status `checked` / `unchecked` /
`mixed`, then `disabled` or `read only`), and `pressed` rides the visible
`control` / `item-control` while a touch is held.

```tsx
import { Checkbox, CheckboxGroup, RadioGroup } from '@sigx/lynx-zero';

// A boolean box — `checkedChange` reports this box's state.
<Checkbox.Root model={() => state.agreed} color="primary">Accept the terms</Checkbox.Root>

// Array mode: boxes sharing a string[] model toggle their own `value`.
<Checkbox.Root model={() => state.tags} value="news">News</Checkbox.Root>

// A group with a tri-state "select all" box.
<CheckboxGroup.Root model={() => state.toppings} orientation="horizontal">
    <CheckboxGroup.Label>Toppings</CheckboxGroup.Label>
    <Checkbox.Root parent>All</Checkbox.Root>
    <Checkbox.Root value="ham">Ham</Checkbox.Root>
    <Checkbox.Root value="olives">Olives</Checkbox.Root>
</CheckboxGroup.Root>

// Radios — explicit items, or data mode with the collection accessors.
<RadioGroup.Root model={() => state.plan}>
    <RadioGroup.Label>Plan</RadioGroup.Label>
    <RadioGroup.Item value="free">Free</RadioGroup.Item>
    <RadioGroup.Item value="pro">Pro</RadioGroup.Item>
</RadioGroup.Root>
<RadioGroup.Root items={plans} itemKey={(p) => p.id} itemLabel={(p) => p.name} model={() => state.plan} />
```

- **Checkbox.Root** — `model` (`boolean | string[]`) / `defaultChecked`,
  `checkedChange`, `indeterminate` (the app-owned mixed look; a tap flips
  the underlying checkedness), `value` (the membership key, default `"on"`),
  `parent`, `disabled` / `invalid` / `required` / `readonly`, `color`,
  `size`, `label` (the reader's name) and `hideLabel` (render no visible
  label — pass `label`). A `value` prop sits beside the `checkedChange`
  event safely: the runtime-core emit lookup no longer collides with a
  prop named `value` (covered by a unit test).
- **CheckboxGroup.Root** — `model` (`string[]`) / `defaultValue`,
  `valueChange`, `allValues` (what a `parent` box selects; default every
  child's `value`), `orientation` (`vertical` by default), `disabled` /
  `invalid` / `required` / `readonly` (the prop OR an enclosing Field's —
  every box takes them, ORed with its own), `color` (the label's ink) and
  `size` (reaches every box that sets none). A box inside a group needs a
  distinct `value` (a dev warning says so). A `parent` box is `checked`
  when all of `allValues` are selected, `unchecked` when none,
  `indeterminate` when some, and a tap selects all or none.
  **CheckboxGroup.Label** is the visible name.
- **RadioGroup.Root** — `model` (`string`; `''` is "nothing chosen") /
  `defaultValue`, `valueChange`, `items` + `itemKey` / `itemLabel` /
  `itemDisabled` and an `item` slot (data mode; explicit children win
  entirely), `orientation`, `disabled` / `invalid` / `required` /
  `readonly`, `color`, `size`. **RadioGroup.Item** takes `value`
  (required), `disabled`, `label`; tapping the checked item is a no-op.
  `invalid` / `readonly` are restated on every item and item-control.
  **RadioGroup.Label** is the visible name.
- On the daisy skin, a lynx checkbox draws its tick as two borders on a
  rotated box, and draws the indeterminate mark as a bar centred in the box. The tick's
  stroke follows the `size` axis, which the indicator part carries.
  Checkbox and radio have no noise texture on lynx: iOS cannot decode the
  SVG image, and lynx does not apply `clip-path`
  ([signalxjs/zero#401](https://github.com/signalxjs/zero/issues/401);
  ships with the `@sigx/zero-daisyui` release after 0.12.0).
- The group roots are NOT accessibility elements — on lynx that would fold
  every box into one node — so each box or item announces itself.
- Arrow-key roving, `focus-visible` detection and form reset are web
  keyboard/form semantics with no surface here; `focus-visible` still
  renders when forced (`ForceStates`).
## Text fields and Field (zero wave 2)

`Input`, `Textarea` and `Field` carry zero's `input`, `textarea` and
`field` anatomies on the native lynx `<input>` / `<textarea>`:

```tsx
import { Field, Input, Textarea } from '@sigx/lynx-zero';

<Field.Root invalid={!!error} required size="sm">
    <Field.Label>Email</Field.Label>
    <Input.Root model={() => form.email} type="email" enterkeyhint="next">
        <Input.Control>
            <Input.Adornment placement="start"><text>@</text></Input.Adornment>
            <Input.Input placeholder="you@example.com" onConfirm={next} />
            <Input.ClearTrigger />
        </Input.Control>
    </Input.Root>
    {error ? <Field.Error>{error}</Field.Error> : <Field.Description>We never share it.</Field.Description>}
</Field.Root>

<Input.Root type="password" model={() => form.password} model:visible={() => ui.shown}>
    <Input.Control><Input.Input /><Input.VisibilityTrigger /></Input.Control>
</Input.Root>

<Textarea.Root model={() => form.bio} minRows={2} maxRows={6} enterkeyhint="send">
    <Textarea.Label>Bio</Textarea.Label>
    <Textarea.Textarea placeholder="Tell us about yourself" />
</Textarea.Root>
```

| Export | Parts | Notable props / events |
|---|---|---|
| `Input` | `Root`, `Label`, `Control`, `Input`, `Adornment`, `ClearTrigger`, `VisibilityTrigger` | `model` (`string`) / `defaultValue` / `valueChange`; `type` (`text` `email` `password` `search` `tel` `url`); `inputmode`, `enterkeyhint`, `maxlength`, `spellcheck`, `autocorrect`, `autofocus`; `model:visible` / `defaultVisible` / `visibleChange`; `disabled` `invalid` `required` `readonly`; `color` `size`; `label` (accessible name). `Input.Input`: `placeholder`, `focus` / `blur` / `confirm` (Enter, with the text) events |
| `Textarea` | `Root`, `Label`, `Textarea` | as Input (no `type`/`inputmode`/`visible`), plus `minRows` / `maxRows` (autosize) |
| `Field` | `Root`, `Label`, `Description`, `Error` | `disabled` `invalid` `required` `readonly` `color` `size` |

The platform spellings to know:

- **The model is the only value channel.** The Root's controllable state is
  the sigx `Model` the native element binds, so the lynx model processor
  owns write-back (and the iOS deferred initial value). There is no `value`
  prop — a component prop named `value` breaks `emit` in runtime-core.
- **State paints on views, the native field is a text face.** iOS never
  repaints a native text field's styles after mount, so every state that
  paints (invalid border, disabled fade, focus ring) is a class on a view:
  Input's `control`, and Textarea's `textarea` part, which on lynx is a
  view holding the native `<textarea>`. That inner field wears the part's
  base + axis classes (the only way the skin's font size, ink and
  placeholder colour reach a native element) with the box zeroed inline;
  it carries no `data-part`, so it is not a second part instance.
- **`focus-visible` is focus.** A text field shows its ring on any focus
  (as the web's `:focus-visible` does for text inputs), driven by
  `bindfocus`/`bindblur` onto `control` + `input` (Input) or the
  `textarea` part.
- **Taps focus through the UI method.** Lynx has no `<label for>` and no
  `element.focus()`: a tap on a `Label`, on Input's `control` padding or an
  adornment, or on Textarea's box invokes the native field's `focus` method.
  From the background thread that call rides the runtime's
  `INVOKE_UI_METHOD` op, the path `setValue` takes, because a callback
  `ref` there is a ShadowElement with no `invoke` of its own.
  `Field.Label` focuses the first control that registered with the Field
  (zero's `FieldContext.report` seam). The triggers use `catchtap`, so a
  trigger press never also lands on the control.
- **Field is zero's `FieldContext`.** Controls inside — these, and Switch,
  Slider, Select, Button — adopt its flags, and its `size` when they set
  none; it ORs in an enclosing Fieldset's flags. Lynx has no constraint
  validation, so `validate`/`validateOn` and `Field.Error`'s `match` are
  not taken: set `invalid` yourself and mount a `Field.Error` while there
  is something to say. The skin's required-label asterisk is a web
  `::after` and does not render on lynx.
- **Attributes map onto lynx's set.** `enterkeyhint` → `confirm-type`
  (`done` `go` `next` `search` `send`; a `search` field defaults to
  `search`); `inputmode="numeric"`/`"decimal"` pick the `digit`/`number`
  pads on a text field; `spellcheck`/`autocorrect` are iOS-only
  (`ios-spell-check`/`ios-auto-correct`). An unset optional string never
  reaches the native element (iOS would receive `NSNull`). No `name`/`form`
  (no forms), no Escape-to-clear (no hardware Escape), no `modelModifiers`
  timing yet (lynx-side of core#127, #496).
- **Autosize** (`minRows`/`maxRows`) stamps `data-autosize` and grows the
  native field (`auto-height`), capped at `maxRows` lines (`maxlines`).
  The skin's `min-height` is the floor; a row count has no lynx spelling.

## NumberInput and Fieldset

`NumberInput` is zero's spinbutton over lynx's native `<input>`. It has the
anatomy `root` / `label` / `control` / `input` / `increment-trigger` /
`decrement-trigger`. `Fieldset` groups form controls and says
`disabled` / `readonly` / `invalid` once for all of them (`root` / `legend`).

```tsx
import { Fieldset, NumberInput } from '@sigx/lynx-zero';

<Fieldset.Root disabled={!editing}>
    <Fieldset.Legend>Order</Fieldset.Legend>
    <NumberInput.Root model={() => state.qty} min={0} max={99} onValueChange={(v) => save(v)}>
        <NumberInput.Label>Quantity</NumberInput.Label>
        <NumberInput.Control>
            <NumberInput.DecrementTrigger />
            <NumberInput.Input placeholder="0" />
            <NumberInput.IncrementTrigger />
        </NumberInput.Control>
    </NumberInput.Root>
</Fieldset.Root>
```

| `NumberInput.Root` prop | Type | Default | Notes |
|---|---|---|---|
| `model` / `defaultValue` | `number \| null` | `null` | `null` is an empty field, not 0. `valueChange` fires on every commit. |
| `min` / `max` | `number` | — | Bounds. A committed value outside them marks the control `invalid`. |
| `step` | `number` | `1` | The grid, anchored at `min`. |
| `clampOnBlur` | `boolean` | `true` | Clamp a typed value into `[min, max]` on commit. |
| `format` / `parse` | functions | `String` / decimal | The display text and how typed text reads back. `parse` returns `null` for "not a number". |
| `spinInterval` | `number` (ms) | `80` (`NUMBER_INPUT_SPIN_INTERVAL`) | Repeat rate while a trigger is long-pressed. |
| `disabled` / `readonly` / `invalid` / `required` | `boolean` | `false` | Each ORs with the enclosing Field's and Fieldset's. |
| `color` / `size` | skin axes | skin default | `size` falls back to the Field's. |
| `label` | `string` | — | The input's accessible name. |

How it behaves on lynx:

- **Typing is a draft.** Keystrokes do not reach the model. The draft
  commits on blur and on the keyboard's confirm key: it is parsed, snapped
  to the step grid, then clamped. Unparseable text (`-`, `1e`) reverts to
  the last committed value, and empty text commits `null`. A trigger commits
  any pending draft before it steps.
- **Triggers.** A tap steps once. A long press steps, then repeats every
  `spinInterval` ms until the touch ends. A trigger is `disabled` at its
  bound and while the root is disabled or read-only. It carries the
  main-thread press feel and the `pressed` flag. Pass children to replace
  the default `+` / `−` glyph, and `label` to rename it for the reader.
- **The native input.** The visible text rides the `value` attribute. The
  runtime turns a step or a reformatting commit into the element's
  `setValue`, and skips the echo of the user's own typing, so the caret
  stays put. `type` is `digit` when `min >= 0` and `number` otherwise,
  and `text` when you pass a custom `format`. Lynx's `digit` and `number`
  fields run every write, `setValue` included, through a numeric key
  filter, so formatted text like `25 %` could never show in one. The cost
  is the full keyboard in place of the number pad, so pass a `parse` that
  reads your format back. Unset `placeholder` / `label` are left off the element, never sent as
  `undefined` (iOS would receive `NSNull`). Keep the input mounted: a
  remount clears its text.
- **Focus.** Native focus stamps `focus-visible` on `control` and `input`,
  as the web's `:focus-visible` matches any focused text field. The skin
  draws the ring on `control`. A tap on `NumberInput.Label` or on the
  control's box focuses the input. Inside a `Field.Root`, `Field.Label`
  does too, and the control adopts the Field's flags and size. The
  triggers catch their taps, so stepping never opens the keyboard.
- **Not carried:** `hidden-input` and `name` (there are no forms on lynx),
  `locale` / `formatOptions` (`Intl` is not guaranteed on lynx's engines;
  use `format` / `parse`), `largeStep` and wheel stepping (no keyboard or
  wheel), and `asChild` on the triggers.
- **Fieldset** is a `view`, because lynx has no native `<fieldset>`. Its
  flags travel only through zero's `FieldsetContext`. Nested fieldsets chain,
  and any control built on zero's `createFormControl` reads them
  (NumberInput does). `Fieldset.Legend` is a `text` part that repeats the
  root's `disabled` / `invalid` so the skin can dim or tint it. It hands its
  content the OUTER fieldset's flags, the platform's legend exemption.
  The other lynx-zero controls (Button, Switch, Slider, Select, Checkbox,
  CheckboxGroup, RadioGroup, Toggle, ToggleGroup) do not read the Fieldset
  yet ([#1208](https://github.com/signalxjs/lynx/issues/1208)).

## What comes next

The compiled design-system shells (`@sigx/lynx-zero-daisyui`) and the
showcase pilot screens land in the remaining PRs of #1029.
