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
  focused. That includes a screen that a cold deep link opens while the app
  is still mounting: a theme set from a descendant's setup or `onMounted`
  reaches the root host once the provider has mounted
  ([#1193](https://github.com/signalxjs/lynx/issues/1193)).

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
  An ancestor's transform fires no layout event either: a Select opened
  inside an OPENING dialog measured its trigger under the panel's open
  scale and stayed ~8pt off (#1233). The Dialog panel reports when its
  open animation or transition ends (`bindanimationend` /
  `bindtransitionend`, plus two fallback timers per open), and every open
  anchored popup inside it re-measures once, a bounded burst.
- **Dialog avoids the soft keyboard** (#1232). The panel renders through
  the portal, so an app cannot wrap it in a `KeyboardAvoidingView`; it
  makes room itself. While open it follows the keyboard height from the
  native safe-area publisher (`@sigx/lynx-safe-area`'s provider-free
  `subscribeSafeArea`; no `<SafeAreaProvider>` needed, and without the
  native module the height stays 0). The backdrop pads its bottom by the
  keyboard's overlap when that reaches higher than the safe frame, so the
  panel centres in what is still visible. The overlap is measured against
  the outlet's no-keyboard height, so an Android window that resized for
  the keyboard (`adjustResize`) is not lifted twice. The panel is capped
  at the visible box and its body is always a vertical `scroll-view`:
  a panel taller than the space scrolls inside instead of running under
  the keyboard, and the keyboard rising never remounts the focused field.
  A scroll-view clips to its bounds, so the body reaches 4px (the skin's
  widest focus ring) into the panel's padding and gives it back to its
  content: a focused full-width field's ring paints all the way round
  (#1255), and the content sits where it always did.
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
  compose like zero's (`Toast.Root` / `Indicator` / `Title` / `Description`
  / `Action` / `Close`). The viewport renders that stock composition, and
  the parts also render in place outside any viewport (they conform inside
  a viewport part, as the gallery draws them).
- **Promise toasts** (zero 0.6, [#1196](https://github.com/signalxjs/lynx/issues/1196)).
  A toast can carry a `status` (`loading` / `complete` / `error`), and
  `Toast.Indicator` draws it as a mark: the skin's ring, tick or cross. The
  indicator renders nothing while the toast has no status, and it is hidden
  from the reader, because the title says it in words.
  `toaster.promise(promise, { loading, success, error })` keeps one toast
  for the life of a promise. It stays sticky while the promise is pending,
  then it is updated in place with the success or error stage (a title
  string or toast options; either may be a mapper of the value or the
  reason), and the default duration comes back. A rejection is handled
  there, and so is a stage mapper that throws. `toaster.update(id, patch)`
  patches a mounted toast; a new `duration` re-arms its timer. Lynx has no
  `:has()`, so while a mark shows, every part of the toast carries the
  `marked` modifier (`zx-m-marked`). The skin reads it to seat the mark
  beside the text. To compose a promise toast in place, pass `Toast.Root` a
  `toast` object with a `status`.
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
  ships with `@sigx/zero-daisyui` 0.13.0).
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

## Divider, Stats and EmptyState (zero wave 3, display)

Three display components on zero's anatomies. None of them has a machine
state or an interaction flag: they are styled containers, so the skin's
`color` / `size` axes and the orientation are all they take.

```tsx
import { Divider, EmptyState, Stats } from '@sigx/lynx-zero';

<Divider />
<Divider.Root color="primary">
    <Divider.Label>or</Divider.Label>
</Divider.Root>

<Stats.Root>
    <Stats.Item>
        <Stats.Figure><Avatar /></Stats.Figure>
        <Stats.Title>Downloads</Stats.Title>
        <Stats.Value>31K</Stats.Value>
        <Stats.Desc>Jan 1 – Feb 1</Stats.Desc>
    </Stats.Item>
    <Stats.Item color="warning">
        <Stats.Title>Refunds</Stats.Title>
        <Stats.Value>31</Stats.Value>
    </Stats.Item>
</Stats.Root>

<EmptyState.Root color="error">
    <EmptyState.Icon><text>⚠</text></EmptyState.Icon>
    <EmptyState.Title>Could not load your projects</EmptyState.Title>
    <EmptyState.Description>The server did not answer. Your work is saved.</EmptyState.Description>
    <EmptyState.Actions>
        <Button.Root onPress={retry}><text>Try again</text></Button.Root>
    </EmptyState.Actions>
</EmptyState.Root>
```

| Part | Prop | Type | Default | Notes |
|---|---|---|---|---|
| `Divider.Root` | `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | A vertical rule stretches to its row's height. |
| `Divider.Root` | `color` / `size` | skin axes | skin default | The ink and the thickness. |
| `Divider.Root` | `decorative` | `boolean` | `false` | Zero parity. Lynx has no separator role to drop, so it changes nothing. |
| `Divider.Label` | `placement` | `'start' \| 'end'` | centred | The edge the label sits flush against. |
| `Stats.Root` | `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Mirrored onto every item. |
| `Stats.Root` / `Stats.Item` | `color` | skin axis | skin default | The item re-carries `color`: its own value outranks the root's, for it and its bands. |
| `Stats.Root` | `size` | skin axis | skin default | Steps the value's type size. |
| `EmptyState.Root` | `color` / `size` | skin axes | skin default | The tone (icon ink and surface tint) and the padding/type ramp. |

Every part also takes `class`.

How they behave on lynx:

- **Text parts are `<text>`.** `Divider.Label`, `Stats.Title` / `Value` /
  `Desc` and `EmptyState.Title` / `Description` render as lynx `text`, so
  they take a plain string. `Stats.Figure`, `EmptyState.Icon` and
  `EmptyState.Actions` are views: put a `<text>` glyph, an icon or buttons
  in them.
- **The divider is the line.** An unlabelled `Divider.Root` is itself the
  rule, and it is not an accessibility element. The web draws a labelled
  divider as `::before`/`::after` segments, which lynx does not have. So
  while a `Divider.Label` is mounted, the root draws a segment view on each
  side of it. Each segment carries the root's own line classes plus
  `zx-m-segment`, so it has the same ink and thickness. A `placement`
  leaves out the segment on that side. The root is stamped `labelled`
  (`zx-m-labelled`) and stops painting a line itself. A labelled divider is
  read through its label's text.
- **Stats seams and figure.** The web draws the seam between items with
  `item + item` and places the figure in a grid column. Lynx has neither a
  sibling selector nor grid. So the root tracks its items in mount order and
  stamps the first one `first` (`zx-m-first`), and the skin draws every
  other item's leading seam. An item holding a `Stats.Figure` is stamped
  `figure` (`zx-m-figure`), and the skin pins the figure to the item's end
  edge and keeps room for it. The room fits a 32pt figure, like daisyUI's
  `size-8`.
- **The label and figure stamps are set a microtask after mount.** A child
  mounts while its parent is still rendering, so the parent only sees the
  new child on its next render. The first frame of a labelled divider can
  paint as a bare line.
- **Not carried:** `asChild` on `Stats.Root` and `EmptyState.Title` (lynx has
  no `<dl>` or heading elements to swap in).

## Alert and Card (zero wave 3)

`Alert` is a message the user can dismiss: `root` / `icon` / `title` /
`description` / `close`. `Card` is a surface with a conventional interior:
`root` / `media` / `header` / `title` / `description` / `body` / `footer`.
Both carry the skin's `color` and `size` axes on the root.

```tsx
import { Alert, Button, Card } from '@sigx/lynx-zero';

<Alert.Root color="warning" model={() => state.showQuota}>
    <Alert.Icon><text>⚠</text></Alert.Icon>
    <Alert.Title>Approaching your quota</Alert.Title>
    <Alert.Description>You have used 92% of this month's allowance.</Alert.Description>
    <Alert.Close />
</Alert.Root>

<Card.Root color="primary">
    <Card.Media><image src={cover} mode="aspectFill" style={{ width: '100%', height: '120px' }} /></Card.Media>
    <Card.Header>
        <Card.Title>Monthly report</Card.Title>
        <Card.Description>Updated 4 minutes ago</Card.Description>
    </Card.Header>
    <Card.Body><text>Revenue is up 12%.</text></Card.Body>
    <Card.Footer><Button color="primary"><text>Open</text></Button></Card.Footer>
</Card.Root>
```

| `Alert.Root` prop | Type | Default | Notes |
|---|---|---|---|
| `model` / `defaultOpen` | `boolean` | `true` | Whether the alert is shown. `openChange` fires when Close hides it. |
| `color` / `size` | skin axes | skin default | Size moves the box's padding. |

| `Alert.Close` prop | Type | Default | Notes |
|---|---|---|---|
| `disabled` | `boolean` | `false` | No press, no close; announced disabled. |
| `label` | `string` | `"Close"` | The accessible name. |
| `pressFeel` | `boolean` | `true` | `false` turns off the main-thread press scale. The `pressed` flag stays. |

`Card.Root` takes `color` / `size`. Every other part takes `class` and
children only.

How they behave on lynx:

- **A closed alert unmounts.** Lynx has no `hidden` attribute, so
  unmounting is how the anatomy's `hiddenIn: ['closed']` is kept (the Tabs
  panel precedent). A tap on `Alert.Close` sets the model to `false`.
- **No live region.** Lynx has no `role="alert"` or `aria-live`. The root
  is not an accessible element, because on iOS that would hide its text from
  the reader. The title and description are read as plain text. zero's
  `live` and `finalFocus` props are not taken, since this platform has
  nothing for them to drive.
- **Alert parts.** `Alert.Icon` is decoration and sits outside the
  accessibility tree. `Alert.Title` and `Alert.Description` are `text` parts,
  so pass them a string. `Alert.Close` is a `view` with the `button` trait
  and tier-2 press feedback. It carries the `disabled` and `pressed` flags,
  and draws `×` when it has no children. `focus-visible` is reachable
  through `ForceStates` only.
- **Presence mods (a rendering detail).** The web skin lays the alert out
  on a grid, but lynx has no grid and no `:has()`. So the root tracks
  whether an Icon and a Close are rendered, and stamps `with-icon` and
  `with-close` on the title and description (`zx-m-with-icon`,
  `zx-m-with-close`). The skin uses them to reserve the icon's column and
  the close button's corner.
- **Card parts are views; the title and description are text.** The title
  carries the `header` trait. There is no `asChild`, because lynx has no
  `<article>` or `<figure>` to render instead. Put an `<image>` inside
  `Card.Media`, and size it yourself: a lynx image has no intrinsic size.
  On iOS a view's clip has not reliably rounded a filled child's corners
  ([#1218](https://github.com/signalxjs/lynx/issues/1218)). If your image's
  corners paint square there, give the image the same corner radius.
- **Media's ends are stamped.** The skin rounds the corners that the media
  band shares with the card. The web selects them with `:first-child` and
  `:last-child`, which lynx lacks. Instead the root tracks its bands in
  mount order and stamps `first` / `last` on `Card.Media` (`zx-m-first` /
  `zx-m-last`). A band mounted later, such as a conditional one, joins the
  end of that order.

## Badge, Status and Kbd (zero wave 3, display)

Three small display parts with no behavior. `Badge` is a standing label
(`root`, plus the optional status `dot`), `Status` is a presence dot
(`root`, empty), and `Kbd` is a keycap (`root`).

```tsx
import { Badge, Kbd, Row, Status } from '@sigx/lynx-zero';

<Badge color="success"><text>Active</text></Badge>

<Badge.Root>
    <Badge.Dot color="warning" running />
    <text>Deploying</text>
</Badge.Root>

<Row gap={6} align="center">
    <Status color="success" />
    <text>Online</text>
</Row>
<Status color="error" label="Service degraded" />

<Row gap={4} align="center">
    <Kbd label="Command"><text>⌘</text></Kbd>
    <Kbd><text>K</text></Kbd>
</Row>
```

| Prop | Part | Type | Default | Notes |
|---|---|---|---|---|
| `color` / `size` | all roots | skin axes | skin default (none in daisy) | Unset, daisy paints the base-200 pill / cap and the base-content dot. |
| `variant` | `Badge.Root` | skin axis | — | Stamped when set; the daisy skin declares no badge variants. |
| `label` | all roots | `string` | — | Accessible name (see below). |
| `class` | every part | `string` | — | Appended last. |
| `color` | `Badge.Dot` | skin axis | the pill's | The dot's own colour. Without one it follows the pill's. |
| `running` | `Badge.Dot` | `boolean` | `false` | The thing the pill names is in flight: stamps the `running` state. |

How they behave on lynx:

- **Text is a `<text>` child.** Lynx prints text only inside `<text>`, so
  the badge label and the key glyph are `<text>` children of a `view`
  root. The skin's ink and type size reach them through CSS inheritance
  (`enableCSSInheritance`, which the zero shells assume).
- **The dot re-carries `color`** (zero#94/#130). A dot with a colour of its
  own is that colour. Without one it follows the pill's, and on an
  uncoloured pill it is the pill's ink. Lynx has no descendant selectors,
  so the winning value is stamped on the dot, the same way as Timeline's
  marker.
- **Accessibility.** `Badge.Dot` is decorative and never an accessible
  element. `Status` without `label` is not an accessible element either,
  because it decorates text that already says what it means. With `label`
  it is an element with the `image` trait, named by the label. It is never
  a live region. A `label` on `Badge` or `Kbd` makes the root one named
  element (`label="3 unread"` on a bare count, `label="Command"` on `⌘`).
  Without it the reader reaches the text itself.
- **Not carried:** `asChild` on Badge (lynx has no element to merge onto,
  so a pressable badge is a Badge inside the pressable) and the `<kbd>`
  element's semantics (lynx has no such element).

## Avatar, AvatarGroup, Skeleton, Spinner (zero wave 3)

The display scopes of [#1237](https://github.com/signalxjs/lynx/issues/1237).
None of them take input. Their states come from what they show: an image
loading, content on its way.

```tsx
import { Avatar, AvatarGroup, Skeleton, Spinner } from '@sigx/lynx-zero';

<AvatarGroup.Root label="Project members" size="sm">
    {shown.map((u) => (
        <Avatar.Root key={u.id}>
            <Avatar.Image src={u.photo} alt={u.name} />
            <Avatar.Fallback><text>{u.initials}</text></Avatar.Fallback>
        </Avatar.Root>
    ))}
    <AvatarGroup.Overflow count={members.length - shown.length} />
</AvatarGroup.Root>

<Skeleton.Root model={() => state.pending}>
    <text>{article.title}</text>
</Skeleton.Root>

<Spinner label="Uploading" size="lg" />
```

| Part / prop | Type | Default | Notes |
|---|---|---|---|
| `Avatar.Root` `color` / `size` / `shape` | skin axes | the enclosing group's, else the skin default | daisy: `shape` is `circle` / `square` / `rounded`. `statusChange` reports `loading` / `loaded` / `error`. |
| `Avatar.Image` `src` / `alt` | `string` | — | `alt` is required: once loaded, the image is the avatar's only accessible element. |
| `Avatar.Fallback` `delay` | `number` (ms) | `0` | Keeps the fallback out of the tree for that long, so a fast image never flashes initials first. |
| `AvatarGroup.Root` `label` / `color` / `size` | `string` / skin axes | — | With a `label`, the group is one accessible element named by it. |
| `AvatarGroup.Overflow` `count` / `label` | `number` / `string` | — / `"N more"` | Shows `+N`, announced as `label`. A count of zero or less renders nothing. |
| `Skeleton.Root` `model` / `defaultLoading` | `boolean` | `true` | `loadingChange` fires on change. `label` (default "Loading") is what a reader hears while loading. `color` / `size`. |
| `Spinner` (`Spinner.Root`) `label` / `decorative` | `string` / `boolean` | `"Loading"` / `false` | `color` / `size`. Decorative drops the label and hides the mark from the reader. |

How they behave on lynx:

- **Avatar status.** The lynx `<image>`'s load and error events drive the
  status. A missing `src` is `error`, and so is a root with no
  `Avatar.Image` once it has mounted: the fallback is then the avatar. A new
  `src` loads again. Lynx has no `hidden` attribute, so the face a state
  hides is not rendered, as the anatomy's `hiddenIn` says: the image while
  `error`, the fallback once `loaded`. While `loading` both render, and the
  skin lays the fallback over the pending image.
- **AvatarGroup** pushes its resolved `size` and `color` down to every
  `Avatar.Root` inside it, and an avatar's own prop wins. This is the lynx
  spelling of the web recipe's `composes`, which has no class form here.
  Lynx has no `:first-child`, so the group tracks its avatars in mount order
  and stamps every one after the first `stacked` (`zx-m-stacked`,
  `data-mod-stacked`). The skin overlaps those avatars. An avatar mounted
  later joins the end of that order.
- **Skeleton** keeps its children mounted in both states, so the layout
  does not jump when the content arrives. While loading, the root is one
  accessible element announced as busy (lynx has no `aria-busy`), and the
  skin's `pointer-events: none` keeps taps off the placeholder. The skin's
  transparent ink reaches `<text>` children only through CSS inheritance
  (`enableCSSInheritance`, as the showcase sets it).
- **Spinner** has no state: it spins, or it is not rendered. The skin draws
  the mark on the root. The words are the `label` part, a visually hidden
  `<text>`, and the root is also one accessible element named by them and
  announced as busy, since lynx has no live region.
- **Not carried:** `asChild` on `Avatar.Image` (there is no DOM element to
  merge into), and the skins' `prefers-reduced-motion` stops (lynx emits no
  `@media`, so the spinner and the skeleton pulse keep moving).

## Navbar and Breadcrumbs (zero wave 4, navigation)

The navigation scopes of [#1257](https://github.com/signalxjs/lynx/issues/1257).
`Navbar` is the header bar: `root` / `start` / `center` / `end`.
`Breadcrumbs` is the trail to the current screen: `root` / `list` / `item` /
`link` / `separator`, plus `ellipsis` / `ellipsis-trigger` for a collapsed
trail. Both carry the skin's `color` and `size` axes on the root.

```tsx
import { Breadcrumbs, Button, Navbar } from '@sigx/lynx-zero';

<Navbar.Root color="primary">
    <Navbar.Start><text>Acme</text></Navbar.Start>
    <Navbar.Center><text>Inbox</text></Navbar.Center>
    <Navbar.End><Button variant="ghost" size="sm"><text>Sign in</text></Button></Navbar.End>
</Navbar.Root>

<Breadcrumbs.Root maxItems={3}>
    <Breadcrumbs.List>
        <Breadcrumbs.Item>
            <Breadcrumbs.Link onPress={() => nav.navigate('/')}><text>Home</text></Breadcrumbs.Link>
            <Breadcrumbs.Separator />
        </Breadcrumbs.Item>
        <Breadcrumbs.Ellipsis>
            <Breadcrumbs.EllipsisTrigger />
            <Breadcrumbs.Separator />
        </Breadcrumbs.Ellipsis>
        {/* …middle items… */}
        <Breadcrumbs.Item>
            <Breadcrumbs.Link current><text>Anatomy</text></Breadcrumbs.Link>
        </Breadcrumbs.Item>
    </Breadcrumbs.List>
</Breadcrumbs.Root>
```

| Part / prop | Type | Default | Notes |
|---|---|---|---|
| `Navbar.Root` `color` / `size` | skin axes | skin default | `color` refills the whole bar with the role pair; `size` steps its height. Every section is optional. |
| `Breadcrumbs.Root` `maxItems` | `number` | — | Collapse the trail when it has more items than this. Absent: never collapses. |
| `Breadcrumbs.Root` `itemsBeforeCollapse` / `itemsAfterCollapse` | `number` | `1` / `1` | Items kept before / after the ellipsis while collapsed. |
| `Breadcrumbs.Root` `model:expanded` / `defaultExpanded` | `boolean` | `false` | Whether a collapsible trail shows every item. `expandedChange` fires when the trigger expands it. |
| `Breadcrumbs.Root` `color` / `size` | skin axes | skin default | `color` inks the current crumb; `size` steps the type. |
| `Breadcrumbs.Link` `current` / `label` | `boolean` / `string` | `false` / — | `current` stamps `active` (every other link `inactive`). Emits `press`. |
| `Breadcrumbs.Separator` | children | `/` | A `<text>` glyph; pass your own (`›`). |
| `Breadcrumbs.EllipsisTrigger` `label` / `pressFeel` | `(n) => string` / `boolean` | `"Show N more breadcrumbs"` / `true` | Draws `…` when it has no children. |

`breadcrumbsHidden(total, options)` is the collapse rule as a pure function
(the trail indices a collapse hides), exported for apps that render their
own overflow menu.

How they behave on lynx:

- **Every part is a view.** Lynx has no `<header>`, `<nav>`, `<ol>`,
  `<li>` or `<a>`, and no landmarks. Neither root is an accessible element,
  because on iOS that would hide its content from the reader. Put labels in
  `<text>`: they take the part's ink and size through CSS inheritance
  (`enableCSSInheritance`, as the showcase sets it). The root row and its
  sections lay out as explicit `flex-direction: row` rows in the skin.
- **A link is a tap target, not a URL.** There is no browser to follow an
  `href`, so `Breadcrumbs.Link` emits `press` and the app navigates. It is
  announced with the `link` trait; the current one is announced `selected`,
  the nearest native spelling of `aria-current="page"`. The link anatomy
  declares no flags, so a link has no pressed or focus paint.
- **The separator is a real part.** daisy draws its separator with
  `::before`, which lynx drops. Place `Breadcrumbs.Separator` inside each
  item after its link (not in the last item), so it hides with its item. It
  sits outside the accessibility tree.
- **Collapse is absence.** Lynx has no `hidden` attribute, so a collapsed
  item (`closed`) and the ellipsis outside a collapse render nothing, which
  is how the anatomy's `hiddenIn: ['closed']` is kept (the Tabs precedent).
  The items join the trail in mount order; an item mounted later, such as a
  conditional one, joins the end of that order. Place the ellipsis right
  after the leading `itemsBeforeCollapse` items: lynx cannot compare node
  positions, so a misplaced one is not warned about.
- **The ellipsis trigger** is a `view` with the `button` trait, tier-2
  press feedback and the `pressed` flag, announced `collapsed`. A tap sets
  `expanded`. `focus-visible` is reachable through `ForceStates` only, and
  moving focus to the first revealed link is web-only.
- **Not carried:** `asChild` (no element to merge into), `href`, the
  root's landmark `label`, and the web keyboard handling.

## Menu and NavList (zero wave 4, navigation)

`Menu` is zero's menu button: a trigger, then an anchored popup of actions.
The popup can hold checkbox rows, a radio set and submenus. `NavList` is the
list of links that an app's sidebar or drawer is made of. Both use zero's
`menu` and `nav-list` anatomies.

```tsx
import { Menu, NavList } from '@sigx/lynx-zero';

<Menu.Root onSelect={(value) => run(value)}>
    <Menu.Trigger><text>Actions</text></Menu.Trigger>
    <Menu.Popup>
        <Menu.Item value="rename"><text>Rename</text><Menu.Shortcut>⌘R</Menu.Shortcut></Menu.Item>
        <Menu.Item value="archive" disabled><text>Archive</text></Menu.Item>
        <Menu.Separator />
        <Menu.CheckboxItem value="wrap" model={() => state.wrap}><text>Word wrap</text></Menu.CheckboxItem>
        <Menu.RadioGroup model={() => state.sort}>
            <Menu.GroupLabel>Sort by</Menu.GroupLabel>
            <Menu.RadioItem value="name"><text>Name</text></Menu.RadioItem>
            <Menu.RadioItem value="date"><text>Date</text></Menu.RadioItem>
        </Menu.RadioGroup>
        <Menu.Sub>
            <Menu.SubTrigger><text>Share</text></Menu.SubTrigger>
            <Menu.SubPopup>
                <Menu.Item value="email"><text>Email</text></Menu.Item>
            </Menu.SubPopup>
        </Menu.Sub>
    </Menu.Popup>
</Menu.Root>

<NavList.Root color="primary">
    <NavList.Group>
        <NavList.Heading>Workspace</NavList.Heading>
        <NavList.List>
            <NavList.Item>
                <NavList.Link current={route() === 'inbox'} onPress={() => nav.push('inbox')}>
                    <NavList.Icon><text>✉</text></NavList.Icon>
                    <text>Inbox</text>
                    <NavList.Meta><Badge.Root size="sm"><text>12</text></Badge.Root></NavList.Meta>
                </NavList.Link>
            </NavList.Item>
        </NavList.List>
    </NavList.Group>
</NavList.Root>
```

| Part | Prop | Type | Default | Notes |
|---|---|---|---|---|
| `Menu.Root` | `model` / `defaultOpen` / `onOpenChange` | `boolean` | `false` | Whether the popup is open. |
| `Menu.Root` | `onSelect` | `(value: string) => void` | — | Fires when a row at any depth is activated, with that row's `value`. |
| `Menu.Root` | `closeOnSelect` | `boolean` | `true` | Close the whole menu when a plain item is picked. |
| `Menu.Root` | `placement` / `offset` | `LynxPlacement` / `number` | `'bottom-start'` / `4` | The popup flips to the other side when it does not fit. |
| `Menu.Root` | `color` / `size` | skin axes | skin default | Worn by the trigger (daisy's btn ramp). |
| `Menu.Trigger` | `disabled` / `label` | `boolean` / `string` | — | `label` is the accessible name when the content is not text. |
| `Menu.Item` | `value` (required) / `disabled` / `label` | `string` / `boolean` / `string` | — | A row that runs an action. |
| `Menu.CheckboxItem` | `value` / `model` / `defaultChecked` / `onCheckedChange` | `string` / `boolean` | `false` | Toggles on tap. The menu stays open unless `closeOnSelect` is set. |
| `Menu.RadioGroup` | `model` / `defaultValue` / `onValueChange` | `string` | `''` | One value for the `RadioItem`s inside it. Renders the `group` part. |
| `Menu.RadioItem` | `value` / `closeOnSelect` / `disabled` | `string` / `boolean` | — | Checked while the group's value matches. The menu stays open by default. |
| `Menu.Sub` | `model` / `defaultOpen` / `onOpenChange` / `placement` / `offset` | `boolean` / … | `false`, `'right-start'` | One submenu level. |
| `NavList.Root` | `color` / `size` | skin axes | skin default | The current link's ink and fill, and the type and padding ramp. |
| `NavList.Link` | `current` | `boolean` | `false` | The page the user is on. It sets the `active` state and is announced as selected. |
| `NavList.Link` | `onPress` / `label` | event / `string` | — | Navigate from `onPress`. There is no `href` on lynx. |

Every part also takes `class`. The rows, triggers and links also take `pressFeel={false}`, which turns off the main-thread press scale.

How they behave on lynx:

- **The popup is the overlay machinery Popover and Select use.** The
  trigger measures itself, and the popup renders in the `ZeroRoot` outlet at
  the resolved side, which is stamped as `data-placement`. A tap outside
  every open level closes the whole menu, as light dismiss does on the web.
  A tap on the parent level's rows still reaches them. The dismiss stack
  (`dismissTopLayer`, for a back button) closes the innermost level first.
- **Touch, not keyboard.** There is no roving focus, no typeahead and no
  arrow-key navigation. A row is activated by a tap. The row under the
  finger is stamped `highlighted` and `pressed`, so it gets the skin's
  hover wash. A sub-trigger opens its submenu on tap, not on hover.
  `focus-visible` on the trigger is never set live. The gallery forces it.
- **Submenus on a phone.** A submenu opens beside its sub-trigger in its
  own outlet entry, above the parent. Two popups side by side do not fit a
  portrait screen, so when neither side fits, the submenu slides back over
  its parent instead of running off the screen (the `shift` option of the
  placement math).
- **Glyphs are `<text>`.** The web draws the checkbox and radio rows' ✓ and
  the sub-trigger's › with `::after`, and lynx has no pseudo-elements. So
  `item-indicator` is a `<text>` that holds ✓ while the row is checked (and
  is empty, keeping its column, while it is not), and the sub-trigger
  renders its › as a trailing `<text>`.
- **Rows and parts.** `GroupLabel`, `Shortcut` and `NavList.Heading` render
  as lynx `text`, so they take a plain string. `NavList.Icon` and
  `NavList.Meta` are views, so put a `<text>` glyph, an icon or a `Badge`
  in them.
- **`value` rows never emit.** A component with a `value` prop cannot use
  runtime-core's `emit()`, so `Menu.Root` emits `select` for its rows.
  `Menu.CheckboxItem` calls its own `onCheckedChange` handler directly.
- **NavList has no behavior.** Which link is current is known by the
  router, and the app passes it in as `current`. The link has no `pressed`
  flag in the anatomy, so a held link gets the main-thread scale and no
  skin wash. Lynx has no navigation landmark, so the root and groups are
  plain views. A heading is announced with the `header` trait.
- **Not carried:** `Menu.Arrow`, `Menu.ContextTrigger` (a long-press
  anchor is a follow-up), `keyshortcuts`, the `Menubar` identity (`value`
  on `Menu.Root`), `asChild`, and `NavList.Root`'s landmark `label`.

## What comes next

The compiled design-system shells (`@sigx/lynx-zero-daisyui`) and the
showcase pilot screens land in the remaining PRs of #1029.
