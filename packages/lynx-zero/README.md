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
- **Overlays die with their owner.** An overlay whose component unmounts
  while open (its screen popped, say) leaves the outlet with it, and a
  `ZeroRoot` inside a popped screen takes its outlet along: the runtime
  commits a fixed node's removal on its own, because the engine left the
  view of a fixed node that left together with its ancestors painted over
  the next screen (#1291).
- **The Android back button closes the innermost overlay first.** While
  any layer is open (Dialog, Drawer, Popover, Select, Menu and its
  submenus, Combobox), the dismiss stack holds a back interceptor
  (`addBackInterceptor` from `@sigx/lynx`), and `@sigx/lynx-navigation`'s
  back wiring offers every press to it before popping: one press closes
  one layer, and only a press with nothing open navigates (#1290). A
  layer that won't close (`dismissible={false}`) still consumes the press.
  Tooltips and toasts are not layers, so back passes them by. Without
  lynx-navigation nothing dispatches to the interceptor, and back keeps
  its platform default.
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
  `zx-m-segment`, so it has the same ink and thickness, and centres itself
  on the label across the rule (#1272). A `placement`
  leaves out the segment on that side. The root is stamped `labelled`
  (`zx-m-labelled`) and stops painting a line itself. A labelled divider is
  read through its label's text.
- **Thickness is `height` / `width`.** Lynx ignores `block-size` and
  `inline-size`, which is where daisy puts the rule's thickness. Since
  signalxjs/zero#479, zero-kit's lynx emitter ships them as `height` /
  `width` (lynx has no writing modes). A skin compiled with an older
  zero-kit draws no bare rule, and its segments fill the label row
  (#1250).
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
  through `ForceStates` only. Lynx does not carry the close's
  `line-height: 1` into the glyph's `<text>`, so the daisy skin sizes the
  close as a square chip on lynx, with the glyph centred. Its press wash and
  focus ring are square too (signalxjs/zero#479, #1253).
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
- **The cap face.** The web draws a keycap in monospace because of the
  browser's UA style for `<kbd>`. Lynx has no UA sheet, so the daisy skin
  sets `font-family: Menlo, monospace` on the root, and the glyph's
  `<text>` inherits it (signalxjs/zero#479, #1254). iOS resolves Menlo.
  Android Lynx does not resolve the CSS generic families on its own, so
  `@sigx/lynx-cli`'s Android host maps `monospace`, `serif` and
  `sans-serif` onto the system faces (#1260) and the cap is mono there
  too. Projects generated before that pick it up on the next
  `sigx prebuild`.
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
- **A section never breaks a word.** On the web, a start or end section
  shares the slack (`flex: 1 1 0%`) but never shrinks below its longest
  word, because of the flex item's automatic minimum. Lynx has no automatic
  minimum, and its `min-width` takes no intrinsic keyword. So the daisy skin's
  lynx section starts each end from its content (`flex-basis: auto`), never
  shrinks it, and splits the slack between the ends. The centre never
  shrinks either, as in daisy. A bar narrower than its content overflows
  whole instead of wrapping `Acme` as `Acm` / `e` (#1274). There is one
  difference from the web. With a centre and ends of unequal width, the
  centre sits off-centre by half the difference. This arrives with the zero
  release that carries signalxjs/zero#500.
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
| `Menu.Sub` | `model` / `defaultOpen` / `onOpenChange` / `placement` / `offset` | `boolean` / … | `false`, `'right-start'` | One submenu level. Opening it closes a sibling submenu that is open at the same level. |
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
  (`dismissTopLayer`, also the Android back button) closes the innermost
  level first.
- **Touch, not keyboard.** There is no roving focus, no typeahead and no
  arrow-key navigation. A row is activated by a tap. The row under the
  finger is stamped `highlighted` and `pressed`, so it gets the skin's
  hover wash. A sub-trigger opens its submenu on tap, not on hover.
  `focus-visible` on the trigger is never set live. The gallery forces it.
- **Submenus on a phone.** A submenu opens beside its sub-trigger in its
  own outlet entry, above the parent. Two popups side by side do not fit a
  portrait screen, so when neither side fits, the submenu slides back over
  its parent instead of running off the screen (the `shift` option of the
  placement math). It slides on the side with more room, so it covers as
  little of its parent as it can: a nested submenu whose parent submenu
  already sits against the trailing edge opens on the leading side, and
  the parent's rows stay visible. As on the web, each level has at most one open
  submenu: opening a submenu closes any open sibling, whether it opened by
  a tap, by `defaultOpen` or through its `model`. A controlled sibling is
  closed through its model, and `openChange(false)` fires. A nested submenu
  is a child of its parent level, not a sibling, so its parent stays open.
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

## TreeView (zero wave 4, navigation)

zero's `tree-view` scope from [#1256](https://github.com/signalxjs/lynx/issues/1256).
It shows nested branches that expand and collapse, with single or multiple
selection and an optional tri-state check model.

```tsx
import { TreeView } from '@sigx/lynx-zero';

<TreeView.Root model={() => state.selected} defaultExpandedValues={['src']}>
    <TreeView.Label>Files</TreeView.Label>
    <TreeView.Tree>
        <TreeView.Branch value="src">
            <TreeView.BranchTrigger>
                <TreeView.BranchIndicator /><text>src</text>
            </TreeView.BranchTrigger>
            <TreeView.BranchContent>
                <TreeView.Item value="src/index.ts"><text>index.ts</text></TreeView.Item>
            </TreeView.BranchContent>
        </TreeView.Branch>
        <TreeView.Item value="README.md"><text>README.md</text></TreeView.Item>
    </TreeView.Tree>
</TreeView.Root>

// Checkable: boxes in the rows; a branch's state derives from its leaves.
<TreeView.Root model:checkedValues={() => state.checked}>
    …<TreeView.Item value="a"><TreeView.NodeCheckbox /><text>a</text></TreeView.Item>…
</TreeView.Root>
```

| Part / prop | Type | Default | Notes |
|---|---|---|---|
| `TreeView.Root` `model` / `defaultValue` | `string` (`string[]` under `multiple`) | `''` / `[]` | The selection. `valueChange` fires on change. `''` means "nothing selected" in single mode, so a node cannot use it as its value. |
| `TreeView.Root` `multiple` | `boolean` | `false` | A tap toggles a node in or out of the selection. |
| `TreeView.Root` `model:expandedValues` / `defaultExpandedValues` | `string[]` | `[]` | The open branches. `expandedValuesChange` fires on change. |
| `TreeView.Root` `expandOnClick` | `boolean` | `true` | A tap on a branch row toggles it as well as selecting it. With `false`, the row only selects and the `BranchIndicator` toggles. |
| `TreeView.Root` `model:checkedValues` / `defaultCheckedValues` / `checkable` | `string[]` / `boolean` | — | The checked leaf values. Setting any of the three makes the tree checkable. `checkedValuesChange` fires on change. |
| `TreeView.Root` `disabled` / `color` / `size` / `pressFeel` | `boolean` / skin axes / `boolean` | — / skin default / `false` | `disabled` disables every node. `pressFeel` adds the main-thread scale to the rows. |
| `TreeView.Item` / `TreeView.Branch` `value` | `string` | required | The node's identity. |
| `TreeView.Item` / `TreeView.Branch` `disabled` | `boolean` | `false` | The node takes no taps and shows no press. It keeps its selection and check state. |
| `TreeView.Branch` `loading` | `boolean` | `false` | The indicator shows `loading` whatever the expansion. The content shows it only while open. |
| `TreeView.Item` / `TreeView.BranchTrigger` `label` | `string` | the row's text | The accessible name, for rows whose text reads badly aloud. |
| `TreeView.BranchIndicator` | slot | `›` | The default glyph is a `<text>` part. With a slot, the part is a `<view>` wrapping your content. The skin turns it while the branch is open. |
| `TreeView.NodeCheckbox` | slot | `✓` / `−` | The node's check box, placed in an `Item` or a `BranchTrigger`. Tapping it toggles the check and does not select or expand the row. |

How it behaves on lynx:

- **Taps, no keyboard.** A tap on a leaf selects it. A tap on a branch row
  selects the branch and toggles it. Under `multiple` a tap toggles the node
  in or out of the selection. There are no modifier keys, so there is no
  range selection. zero's roving focus, typeahead and arrow keys are not
  wired. `focus-visible` is still in the anatomy: the skin draws it and
  `ForceStates` shows it, but nothing sets it at runtime.
- **Checkable.** A branch is `checked` when every enabled leaf below it is,
  and `indeterminate` when only some are. Toggling a branch checks or
  unchecks all its enabled leaves, and a disabled leaf keeps its value. When
  the tree is checkable and has no selection model (no `multiple`, `model`
  or `defaultValue`), a tap on a leaf row toggles its check instead, and no
  row is announced as selected.
- **Collapsed content stays mounted.** A closed `BranchContent` keeps the
  anatomy's `hidden` attribute, the way the web keeps its subtree in the
  DOM. Its nodes stay registered, so a collapsed branch still shows the
  right check state. It is not `display: none`: on lynx a `display: none`
  view's text keeps painting over the branch row (#1271). The closed content
  is taken out of flow as a clipped, transparent, `visibility: hidden` 0×0
  box, and it is hidden from accessibility.
- **The reader.** Each row is one accessible element (a `button`). Its
  status lists checked, unchecked or mixed, then selected, then expanded or
  collapsed, then disabled. The root, the tree and the branch wrapper are
  not accessible elements. The indicator and the check box are hidden from
  the reader, because the row already says what they show.
- **Press.** A row gets the `pressed` flag while touched. It does not scale
  (daisy's rows darken instead) unless you set `pressFeel` on the Root.
- **The row inks its label.** Your row text takes its colour from the row,
  so a selected row's label turns the accent's `-content` colour. On lynx
  the skin must not transition a row's `color`: Lynx's animator applies a
  transitioned colour to the row's own paint only, and the label keeps the
  old ink, so a row selected by a tap showed dark text on the accent fill
  (#1292). The daisy skin transitions only the row's background on lynx
  ([signalxjs/zero#522](https://github.com/signalxjs/zero/pull/522), with
  the next zero bump). A custom skin needs the same rule.
- **Indentation** comes from the skin: `branch-content` has a left padding
  (a physical one, since Android ignores the logical spelling), and the
  nesting adds it up.
- **Not carried:** `asChild` on rows (there is no DOM element to merge
  into), `aria-level` (lynx has no equivalent), and the skins' right-to-left
  indicator mirror and `prefers-reduced-motion` stop (lynx emits neither
  `:dir()` nor `@media`).

## Pagination and Steps (zero wave 4, navigation)

The navigation scopes of [#1258](https://github.com/signalxjs/lynx/issues/1258).
Pagination picks a page from a numbered range. Steps is a wizard's step rail,
with optional panels and Back/Next.

```tsx
import { Pagination, Steps } from '@sigx/lynx-zero';

<Pagination.Root count={20} model={() => state.page} withEdges />

<Steps.Root model={() => state.step} linear>
    <Steps.Item value="cart" label="Cart">
        <Steps.Indicator><text>1</text></Steps.Indicator>
        <Steps.Title>Cart</Steps.Title>
        <Steps.Separator />
    </Steps.Item>
    <Steps.Item value="pay" label="Pay" invalid={!state.cardOk}>
        <Steps.Indicator><text>2</text></Steps.Indicator>
        <Steps.Title>Pay</Steps.Title>
    </Steps.Item>
    <Steps.Content value="cart"><text>…</text></Steps.Content>
    <Steps.Content value="pay"><text>…</text></Steps.Content>
    <Steps.PrevTrigger><text>Back</text></Steps.PrevTrigger>
    <Steps.NextTrigger><text>Next</text></Steps.NextTrigger>
</Steps.Root>
```

| Part / prop | Type | Default | Notes |
|---|---|---|---|
| `Pagination.Root` `model` / `defaultPage` | `number` | `1` | `pageChange` fires on change. The page is clamped to `1…count`. |
| `Pagination.Root` `count` | `number` | — | Required. The total number of pages. |
| `Pagination.Root` `siblingCount` / `boundaryCount` | `number` | `1` / `1` | Pages beside the current one, and pages pinned at each end. |
| `Pagination.Root` `withEdges` | `boolean` | `false` | Adds the first/last triggers (`«` / `»`) outside prev/next. |
| `Pagination.Root` `pageLabel` / `prevLabel` / `nextLabel` / `firstLabel` / `lastLabel` | `(n) => string` / `string` | `"Page N"`, `"Previous page"`, … | What a reader hears. The glyphs are never the name. |
| `Pagination.Root` `disabled` / `pressFeel` / `color` / `size` | `boolean` / skin axes | — | `pressFeel={false}` keeps the pressed flag but drops the main-thread scale. |
| `Steps.Root` `model` / `defaultStep` | `string` | — | `stepChange` fires on change. `orientation` is `horizontal` (default) or `vertical`. |
| `Steps.Root` `linear` | `boolean` | `false` | Steps past the next reachable one are disabled. Going back is never gated. |
| `Steps.Root` `invalidLabel` / `disabled` / `pressFeel` / `color` / `size` | `string` / `boolean` / skin axes | `", has errors"` | `invalidLabel` is appended to an invalid item's name. |
| `Steps.Item` `value` / `label` | `string` | — | `label` is the step's accessible name. |
| `Steps.Item` `color` / `disabled` / `invalid` | skin colour / `boolean` | the root's | The item re-carries `color`: one step can paint its own tone. `invalid` flags the item, its indicator and its separator. |
| `Steps.Indicator` / `Steps.Separator` | — | — | The numbered disc (pass a `<text>`), and the line from this step toward the next. |
| `Steps.Title` / `Steps.Description` | — | — | `<text>` parts: pass a string. |
| `Steps.Content` `value` | `string` | — | The step's panel. Only the active step's renders. |
| `Steps.PrevTrigger` / `Steps.NextTrigger` `label` | `string` | — | Move to the nearest enabled step before / after the current one. |

How they behave on lynx:

- **Pagination renders its own row.** The window is zero's constant-width
  shape: boundary pages at both ends, siblings around the current page, and
  an ellipsis where the row elides. Near an edge the sibling block slides
  rather than shrinking, so the row keeps its width as you page through.
  Every page and trigger is its own `view` with the `button` trait and its
  own press feedback. The current page is announced as `selected`.
- **A bound is disabled.** Prev and first on page 1, and next and last on
  the last page, stamp `disabled` and ignore taps. So does every control
  under a disabled root. Lynx has no keyboard focus to keep, so the web's
  "focusable but `aria-disabled`" bound is plain disabled here.
- **Steps follow mount order.** The root tracks its items in mount order,
  which is the visual order. An item before the current step is `complete`,
  the current one `active`, the rest `inactive`, and the indicator and
  separator follow their item. An item mounted later (a conditional one)
  joins the end of the order.
- **Only the active panel renders.** Lynx has no `hidden` attribute, so an
  inactive `Steps.Content` is not rendered, like `Tabs.Panel`.
- **`wizard` is stamped.** On the web the rail wraps onto its own line when
  the root holds a panel or a trigger, through `:has()`. Lynx has no
  `:has()`, so the root stamps `wizard` (`zx-m-wizard`, `data-mod-wizard`)
  while any `Steps.Content`, `PrevTrigger` or `NextTrigger` is mounted, and
  the skin wraps on that.
- **An invalid step** appends `invalidLabel` to its `label`. Without a
  `label`, the words ride in the item as visually hidden text.
- **Not carried:** zero's link mode (`getPageHref`: lynx has no anchors),
  the `nav` landmark name and the rail's group name (lynx has no landmark or
  group roles, and marking the root an accessible element would hide its
  controls on iOS), roving focus, arrow keys and `loop` (there is no
  keyboard), and `lazyMount` (inactive panels never render). `focus-visible`
  is reachable through `ForceStates` only, as on every lynx-zero part.

## Drawer and Tooltip (zero wave 5, overlays)

The overlay scopes of [#1277](https://github.com/signalxjs/lynx/issues/1277).
Drawer is an edge panel: a side sheet for navigation or filters, or a sheet
from the top or bottom. Tooltip is a short label anchored to its trigger,
opened by a long press.

```tsx
import { Drawer, Tooltip } from '@sigx/lynx-zero';

<Drawer.Root model={() => state.nav} placement="start" onClose={(d) => log(d.reason)}>
    <Drawer.Trigger><text>Menu</text></Drawer.Trigger>
    <Drawer.Panel>
        <Drawer.Title>Navigation</Drawer.Title>
        …links…
        <Drawer.Close><text>Close</text></Drawer.Close>
    </Drawer.Panel>
</Drawer.Root>

<Tooltip.Root placement="top">
    <Tooltip.Trigger label="Save"><text>💾</text></Tooltip.Trigger>
    <Tooltip.Popup>
        <text>Save the document</text>
        <Tooltip.Arrow />
    </Tooltip.Popup>
</Tooltip.Root>
```

| Part / prop | Type | Default | Notes |
|---|---|---|---|
| `Drawer.Root` `model` / `defaultOpen` | `boolean` | `false` | Open state. `openChange` fires on change. |
| `Drawer.Root` `placement` | `'start' \| 'end' \| 'top' \| 'bottom'` | `'start'` | The edge. `start` is the left edge and `end` the right one (lynx has no right-to-left flow). |
| `Drawer.Root` `modal` | `boolean` | `true` | `true`: a sheet in the overlay outlet, over a dim. `false`: the panel renders in place while open (`data-l-dock="inline"`), with no dim and no dismiss layer. |
| `Drawer.Root` `dismissible` | `boolean` | `true` | Whether a tap on the dim or the back button closes it. The drawer still consumes a back press when this is `false`. |
| `Drawer.Root` `close` event | `{ reason, value? }` | — | Fires once per close, after `openChange(false)`. `reason` is `close` (Drawer.Close), `backdrop`, `escape` (a back-button dismissal) or `programmatic` (a model write). `value` is the closing `Drawer.Close`'s `value`. |
| `Drawer.Root` `color` / `size` | skin axes | skin default | Carried by the trigger; every part stamps them. |
| `Drawer.Panel` `measure` | `number \| 'full'` | the skin's cap | The panel's width in px, or the whole window. For `top` / `bottom` a number narrows the sheet and centres it. |
| `Drawer.Trigger` / `Drawer.Close` | `disabled`, `label`, `pressFeel` | — | Buttons with the `pressed` flag and the main-thread press scale. The trigger's status says expanded or collapsed. |
| `Drawer.Close` `value` | `string` | — | Reported on the `close` event. |
| `Drawer.Title` `visuallyHidden` | `boolean` | `false` | Kept for the reader, out of layout and paint. |
| `Tooltip.Root` `model` / `defaultOpen` | `boolean` | `false` | Open state. `openChange` fires on change. |
| `Tooltip.Root` `placement` / `offset` | a side (`top`, `bottom-start`, …) / px | `'top'` / `8` | The preferred side. It flips when that side has no room, and the resolved side is stamped as `data-placement`. |
| `Tooltip.Root` `closeDelay` | `number` (ms) | `1500` (`TOOLTIP_CLOSE_DELAY`) | How long the popup stays after the finger lifts. |
| `Tooltip.Trigger` | `disabled`, `label` | — | A long press opens the popup. A disabled trigger never does. `label` names the trigger for the reader. |
| `Tooltip.Arrow` | — | — | The mark on the popup edge that faces the trigger, pointing at its centre. |

How they behave on lynx:

- **The drawer is an overlay.** Like Dialog, the panel and the dim render
  in the overlay outlet (`ZeroRoot`), and closed means unmounted. A tap on
  the dim closes the drawer through the dismiss stack, innermost layer
  first, and a tap inside the panel never reaches the dim.
- **The edge geometry is set by the component, not the skin.** The web
  recipe sizes the sheet with `100dvh` and `85dvh` and pins it with logical
  insets. Lynx does not resolve those against the outlet, and Android does
  not resolve logical insets at all. So the dim lays the panel out on its
  edge with flexbox: a side panel stretches to the full height, and a
  top or bottom sheet takes the full width and at most 85% of the window's
  height. A side panel is 85% of the window wide, and the skin caps it
  (daisy: `20rem`), which gives the web's `min(20rem, 85vw)`. `measure`
  replaces that.
- **Safe frame and keyboard.** The panel's paper reaches the screen edges.
  Its content is padded by the safe frame on the edges it touches, so links
  never sit under the status bar or the home indicator. When the keyboard
  rises, the bottom padding grows to clear it. The content is a scroll
  body, so a long list scrolls inside the panel.
- **The slide.** The skin animates the panel in from its edge (the
  `targets.lynx` keyframes). When the animation ends, anchored popups
  inside the panel, such as a Select, measure again.
- **Tooltip: a long press instead of hover.** A touch screen has no hover
  and no keyboard focus. A long press on the trigger opens the tooltip, and
  lifting the finger starts `closeDelay`. A plain tap goes to the trigger's
  content, so a Button inside still presses. A tap on the popup closes it
  at once. A tooltip opened by `model` or `defaultOpen` stays open until
  the app closes it.
- **Tooltip: the bubble sizes to its text.** The popup states
  `width: max-content`. It renders inside a 0×0 overlay root, and Android
  bounds an absolute child's auto width by that root, so without it the
  bubble collapsed to one glyph wide. The skin's `max-width` still caps
  it, and a longer label wraps inside the cap.
- **Tooltip: no light dismiss.** As with the web's `popover="manual"`, the
  tooltip covers nothing and takes no back press. Taps elsewhere belong to
  the page. Because nothing covers the page, nothing tracks a scroll under
  an open tooltip either: the bubble stays where it opened until it times
  out.
- **The arrow is placed by the component.** The web strategy writes
  `--arrow-x` / `--arrow-y`, and the recipe picks the edge from the
  popup's placement. Lynx CSS has no descendant selectors and inline custom
  properties are not reliable, so `Tooltip.Arrow` sets its own position: an
  8px square turned 45°, half outside the popup edge that faces the
  trigger, at the trigger's centre. It stays inside the popup when the
  popup is clamped to a screen edge. The skin paints it.
- **Anchored popups sit on whole pixels.** Tooltip, Popover, Select, Menu
  and Combobox place their popup at a rounded `top` / `left`, and the
  placement ignores re-measures of the popup's size within a pixel. On iOS
  a popup centred at a fractional offset re-measured a third of a point
  wider or narrower, which moved it again on every frame until the engine's
  event limit tripped.
- **Not carried:** the drawer's responsive `modal={{ below }}` mode and
  `dock-above` (lynx compiles no media queries), swipe to dismiss and its
  `swiping` flag, `initialFocus` / `finalFocus` / `preventScroll` (lynx has
  no document focus or scroll to manage), `escapeKeyDown` /
  `interactOutside` (there is no keyboard, and the dim is the only
  outside), the root's `label` (lynx cannot name a container without
  hiding its children from the reader, so use a visible or `visuallyHidden`
  `Drawer.Title`), and `asChild`. The tooltip does not carry
  `Tooltip.Group` or `openDelay`, which are hover timing, or
  `aria-describedby`, which lynx cannot express. Its trigger declares no
  `pressed` or `focus-visible` flag.

## Carousel and Table (zero wave 5, complex)

The complex scopes of [#1279](https://github.com/signalxjs/lynx/issues/1279).
Carousel pages through slides in a horizontal scroller. Table lays data out
in rows and columns, with sortable headers.

```tsx
import { Carousel, Table, nextTableSort } from '@sigx/lynx-zero';

<Carousel.Root model={() => state.slide}>
    <Carousel.Viewport>
        <Carousel.Item><image src={a} /></Carousel.Item>
        <Carousel.Item><image src={b} /></Carousel.Item>
    </Carousel.Viewport>
    <Carousel.PrevTrigger />
    <Carousel.NextTrigger />
    <Carousel.IndicatorGroup>
        <Carousel.Indicator index={0} />
        <Carousel.Indicator index={1} />
    </Carousel.IndicatorGroup>
</Carousel.Root>

<Table.Root mods={{ zebra: true }} model:sort={() => state.sort}>
    <Table.Caption>People</Table.Caption>
    <Table.Head>
        <Table.Row>
            <Table.HeaderCell sortable column="name">Name</Table.HeaderCell>
            <Table.HeaderCell>Age</Table.HeaderCell>
        </Table.Row>
    </Table.Head>
    <Table.Body>
        {sorted(rows, state.sort).map((row) => (
            <Table.Row key={row.id} selected={row.id === state.picked}>
                <Table.Cell>{row.name}</Table.Cell>
                <Table.Cell>{String(row.age)}</Table.Cell>
            </Table.Row>
        ))}
    </Table.Body>
</Table.Root>
```

| Part / prop | Type | Default | Notes |
|---|---|---|---|
| `Carousel.Root` `model` / `defaultIndex` | `number` | `0` | The active slide, 0-based. `indexChange` fires once per move. The index is clamped to the slides that exist. |
| `Carousel.Root` `pressFeel` / `color` / `size` | `boolean` / skin axes | — | `pressFeel={false}` keeps the pressed flag on the triggers and dots but drops the main-thread scale. |
| `Carousel.Viewport` | — | — | The paging `<scroll-view>`. Give it a height (`class`) when the slides have none of their own. |
| `Carousel.Item` | — | — | One slide. It takes the viewport's measured width. |
| `Carousel.PrevTrigger` / `Carousel.NextTrigger` `label` | `string` | `"Previous slide"` / `"Next slide"` | Content defaults to a `‹` / `›` glyph. Disabled at their bound; no wrap. |
| `Carousel.IndicatorGroup` | — | — | The dots' row. |
| `Carousel.Indicator` `index` / `label` | `number` / `string` | — / `"Go to slide n"` | Required `index`. The active dot is announced `selected`. |
| `Table.Root` `columns` | `TableColumn[]` | — | Per column a `key`, `label`, `width` (`number`, `'Npx'` or `'N%'`), `align` (`start`/`center`/`end`) and `sortable`. |
| `Table.Root` `model:sort` / `defaultSort` | `TableSort \| null` | `null` | `{ column, direction }`. `sortChange` fires on change. The runtime never re-orders rows. |
| `Table.Root` `sortCycle` | `'two' \| 'three'` | `'two'` | `three` adds a press back to unsorted. `nextTableSort` is the same rule, exported. |
| `Table.Root` `stack` | `boolean \| 'sm' \| 'md' \| 'lg' \| 'xl' \| '2xl'` | — | The stacked mode: `true` always, a breakpoint below that screen width (640, 768, 1024, 1280, 1536). |
| `Table.Root` `mods` / `pressFeel` / `color` / `size` | skin mods / `boolean` / skin axes | — | daisy offers `zebra` and `hover`. |
| `Table.Caption` / `Table.Head` / `Table.Body` / `Table.Foot` | — | — | A `Table.Head` with no children renders its header row from `columns`. |
| `Table.Row` `selected` | `boolean` | `false` | The shared `selected` flag. |
| `Table.HeaderCell` `sortable` / `column` / `disabled` / `label` | `boolean` / `number \| string` / `boolean` / `string` | — | A sortable cell sorts under its string `column` (or the spec column's `key`). `label` names its trigger. |
| `Table.Cell` `column` / `colSpan` | `number \| string` / `number` | its place / `1` | `column` picks the spec entry by index or key (alignment, the stacked label). |

How they behave on lynx:

- **The carousel viewport is a native paging scroller.** It is a
  `<scroll-view scroll-orientation="horizontal" paging-enabled>`, the
  primitive `Swiper` in `@sigx/lynx-gestures` uses. Android pages a fast
  fling with the platform's physics, but a slow drag rests wherever it
  stops, and the iOS scroll-view has no paging attribute at all. So on
  both platforms the viewport snaps itself when a scroll comes to rest off
  a slide: to the next slide in the drag's direction once the drag has
  moved a fifth of a slide, otherwise back, gliding there with `scrollTo`.
  A rest that native paging already aligned is left alone. A fling that
  coasts past several slides snaps to the one it rests on. A horizontal scroll-view does not resolve `%` widths, so each
  slide takes the viewport's measured width.
- **The model follows real scroll.** The viewport rounds its scroll offset to
  a slide. Setting the model (a trigger, a dot or the app) glides the
  viewport there through its `scrollTo` UI method. The slides a glide passes
  on its way are not reported. Slides and their bounds follow mount order; a
  slide mounted later joins the end.
- **Triggers clamp at the bounds.** Prev on the first slide and next on the
  last stamp `disabled` and ignore taps. Each trigger and each dot has the
  `button` trait and its own press feedback. The dot is the `indicator` part
  itself (the web draws it on `::before`, which lynx lacks), with a widened
  touch area (`hit-slop`).
- **Table rows are flex rows.** Lynx has no `<table>` and no grid. Every part
  is a `view`, and a cell takes its column's width by its place in the row:
  a fixed width, a `%` share, or an equal share of the slack. `colSpan`
  covers that many columns. When every column has a pixel width, the table is
  as wide as their sum and the root scrolls horizontally.
- **Text content is wrapped for you.** A cell, header cell or caption given a
  plain string renders it in a `<text>`, aligned by its column's `align`.
- **Sorting is zero's.** A `sortable` header cell renders its content in the
  pressable `sort-trigger` with the `sort-indicator` ▲ after it (turned for
  descending, hidden while unsorted). The web shows the unsorted mark on
  hover and keyboard focus. Lynx shows it while the trigger is held
  (`zx-m-held` on the indicator). The trigger's name carries the direction
  ("Name, sorted ascending"). A plain-text header label keeps its content
  width (`flex-shrink: 0`), because lynx's flex has no automatic minimum and
  the ▲ beside it would otherwise break a word in a narrow header ("Nam / e",
  #1299). A header too narrow for the label and the mark overflows whole, as
  the web's column grows. The skin holds the mark the same way
  ([signalxjs/zero#522](https://github.com/signalxjs/zero/pull/522)).
- **Zebra is stamped.** Lynx has no `:nth-child`, so the body tracks its rows
  in mount order and stamps each even, unselected row `stripe`
  (`zx-m-stripe`, `data-mod-stripe`). A selected row keeps its own fill.
- **`stack` is resolved in JS**, since lynx has no `@media`. A stacked table
  stamps `stacked` (`zx-m-stacked`) on its parts: each row becomes a block,
  each cell a line that opens with its column's label (the `cell-label`
  part), and the head is visually hidden rather than removed.
- **Not carried:** the table and carousel region names, and the "n of m"
  slide groups (lynx has no region or group roles, and marking a container
  an accessible element hides its content on iOS); the `colgroup` / `column`
  parts and `rowSpan` (there is no table layout to size); hover (the table's
  `hover` mod is accepted and does nothing on touch); keyboard scrolling,
  roving focus and `prefers-reduced-motion`. `focus-visible` is reachable
  through `ForceStates` only, as on every lynx-zero part.

## Combobox (zero wave 5, overlays & complex)

zero's `combobox` scope from [#1278](https://github.com/signalxjs/lynx/issues/1278).
It is a native text field over an anchored list that filters as you type.
It is built from Select's popup and Input's field.

```tsx
import { Combobox } from '@sigx/lynx-zero';

<Combobox.Root
    items={countries}
    itemValue={(c) => c.code}
    itemLabel={(c) => c.name}
    model={() => state.country}
    model:inputValue={() => state.query}
    placeholder="Search countries…"
    emptyText="No match"
    clearable
/>

// Several values: a tag per chosen value, before the field.
<Combobox.Root items={fruits} multiple model={() => state.fruits} />

// A server-filtered list: pass what came back, and no filter.
<Combobox.Root items={results} filter={false} loading={state.busy} loadingText="Searching…"
    model={() => state.pick} model:inputValue={() => state.query} />
```

| Part / prop | Type | Default | Notes |
|---|---|---|---|
| `model` / `defaultValue` | `T \| null`, `V \| null` with `itemValue`, an array under `multiple` | `null` / `[]` | The value. `valueChange` fires on change. |
| `model:inputValue` / `defaultInputValue` | `string` | the preset value's label, else `''` | The text in the field, which is also the filter query. `inputValueChange` fires on change. |
| `model:open` / `defaultOpen` | `boolean` | `false` | The list. `openChange` fires on change. |
| `items`, `itemKey`, `itemLabel`, `itemValue`, `itemDisabled`, `itemGroup` | data accessors | Select's defaults | Data mode only, like Select. The label is what shows and what the filter matches. |
| `filter` | `false \| (item, query) => boolean` | contains-match on the label, case-insensitive | `false` shows every item (a server-filtered list). Read once, at setup. |
| `emptyText` | `string` | — | The `empty` row, shown while nothing matches and the list is not loading. |
| `loading` / `loadingText` | `boolean` / `string` | `false` / `"Loading…"` | The `loading` row renders and `emptyText` holds back. The popup's `accessibility-status` is `busy`. |
| `clearable` / `clearLabel` | `boolean` / `string` | `false` / `"Clear"` | A `clear-trigger` (`×`) in the field while there is a value or text. A tap clears both and focuses the field. |
| `multiple` | `boolean` | `false` | A pick toggles, clears the text and keeps the list open. Each value is a `tag` (label + `tag-remove`) before the field. The `tag` slot replaces a tag's content. |
| `allowCustom` | `boolean` | `false` | Enter with no highlighted option commits the text: the option whose label it is, else the text itself (for string models). A close with text does the same. |
| `autoHighlight` | `boolean` | `false` | While there is a query, the first enabled match is `highlighted` and Enter commits it. |
| `openOnClick` | `boolean` | `false` | The list opens when the field takes focus. By default typing and the trigger open it. |
| `groupSeparators` | `boolean` | `false` | A `separator` rule between runs of options. |
| `placeholder`, `enterkeyhint`, `autocorrect`, `label`, `triggerLabel` | `string` | — / — / — / — / `"Show options"` | Native field attributes and accessible names. |
| `disabled` / `readonly` / `invalid` / `required` | `boolean` | the enclosing Field's | Readonly shows the value but does not open, edit or remove tags. |
| `placement` / `offset` | `LynxPlacement` / `number` | `bottom-start` / `4` | Where the list opens. It flips when the preferred side does not fit. |
| `color` / `size` | skin axes | skin default (size falls back to the Field's) | The popup stamps the colour too, so the accent carries across the portal. |
| `item` slot | `{ item }` | the label | Custom content for an option row. |

How it behaves on lynx:

- **Typing opens and filters.** zero's listbox core does the filtering and
  the selection, so the rules are the web's. In single mode a pick puts the
  label in the field, closes the list and dismisses the soft keyboard.
- **Closing resyncs the text** (zero #265). In single mode, empty text
  clears the value and other text goes back to the value's label, or is
  committed under `allowCustom`. Under `multiple` the query is dropped. A
  blur while the list is open waits for the close, because the blur may
  come from a tap on an option.
- **The filter always reads the field.** A preset value's label is in the
  field, so opening the list with the trigger shows the options that
  contain it, as on the web. Pass `defaultInputValue=""` to open on the
  whole list.
- **The trigger does not raise the keyboard.** It toggles the list, so you
  can browse every option with the keyboard down. A tap on the control's
  padding (or a tag) focuses the field.
- **Keyboard-aware placement.** The list flips and clamps against the
  part of the screen the soft keyboard leaves visible, so a list under a
  raised keyboard opens above its field. The keyboard is followed from the
  moment the field takes focus. Lynx does not scroll a focused field into
  view, so on a tall screen the keyboard can cover the field itself; the
  list is then lifted onto the visible part of the screen, right above the
  keyboard, and you can see what you type filter it. Inside a `Dialog`,
  the dialog lifts itself above the keyboard and the list follows it.
  Select, Menu and Popover place against the same keyboard-trimmed frame.
- **Light dismiss.** A tap outside closes the list. A tap on the field
  while the list is open lands on the dismiss surface, which covers the
  window. That tap focuses the field and keeps the list open.
- **An open list with nothing to show** (no match, no `emptyText`, not
  loading) paints no panel. The field still reads `open`.
- **The list is at least as wide as the field**, like the web's
  `min-width: var(--anchor-width)`. There is no height cap or inner scroll,
  so keep the unfiltered list short or filter it on the server.
- **States.** `open`/`closed` on the control, input, trigger and popup.
  The skin turns the trigger's chevron over while `open`, so the trigger
  takes the `pressed` flag without the main-thread scale: that feel leaves
  an inline `transform` behind that would mask the rotation.
  `focus-visible` on the control and input follows native focus. `pressed`
  on the trigger, the options and a tag's remove button. `highlighted`
  comes from `autoHighlight`. `placeholder` is on the root and control
  while there is no text and nothing chosen.
- **Web-only, not carried:** arrow keys, Home/End, Escape, the tag keyboard
  (zero #411), trigger mode (`@`-mentions), inline completion, windowing
  (`virtual`), hand-written `Combobox.Item` children, and the
  `hidden-input` (lynx has no forms). A tag's `focus-visible` is reachable
  only through `ForceStates`.

## FileUpload, Chat and ChatLog (zero wave 5)

The scopes of [#1276](https://github.com/signalxjs/lynx/issues/1276).
FileUpload holds a list of picked files. Chat is one message row, and
ChatLog is the scrolling transcript around the rows that follows its
newest message.

```tsx
import { Avatar, Chat, ChatLog, FileUpload } from '@sigx/lynx-zero';
import type { FileUploadFile } from '@sigx/lynx-zero';
import { FilePicker } from '@sigx/lynx-file-picker';

<FileUpload.Root
    model={() => state.files}
    accept="image/*,application/pdf"
    multiple
    maxFileSize={10_000_000}
    pick={async ({ multiple, types }) => {
        const result = await FilePicker.pick({ multiple, types });
        return result.cancelled ? [] : result.assets;
    }}
    onFilesReject={(rejected) => showErrors(rejected)}
>
    <FileUpload.Label>Attachments</FileUpload.Label>
    <FileUpload.Dropzone><text>Tap to add files</text></FileUpload.Dropzone>
    <FileUpload.Trigger><text>Browse…</text></FileUpload.Trigger>
    <FileUpload.ItemGroup>
        {(files: FileUploadFile[]) => files.map((f) => (
            <FileUpload.Item key={f.uri ?? f.name} file={f}>
                <FileUpload.ItemName />
                <FileUpload.ItemSize />
                <FileUpload.ItemRemove />
            </FileUpload.Item>
        ))}
    </FileUpload.ItemGroup>
    <FileUpload.ClearTrigger><text>Clear</text></FileUpload.ClearTrigger>
</FileUpload.Root>

<ChatLog.Root label="Conversation with Ada" class="thread">
    <ChatLog.Content>
        {state.messages.map((m) => (
            <Chat.Root key={m.id} placement={m.mine ? 'end' : 'start'} color={m.mine ? 'primary' : undefined}>
                {m.mine ? null : (
                    <Chat.Avatar>
                        <Avatar.Root size="md"><Avatar.Fallback><text>AL</text></Avatar.Fallback></Avatar.Root>
                    </Chat.Avatar>
                )}
                <Chat.Header>{`${m.author} · ${m.time}`}</Chat.Header>
                <Chat.Bubble>{m.text}</Chat.Bubble>
                <Chat.Footer>{m.status}</Chat.Footer>
            </Chat.Root>
        ))}
    </ChatLog.Content>
    <ChatLog.JumpTrigger />
</ChatLog.Root>
```

| Part / prop | Type | Default | Notes |
|---|---|---|---|
| `FileUpload.Root` `model` / `defaultFiles` | `FileUploadFile[]` | `[]` | `filesChange` fires on change. A `FileUploadFile` is `{ name, size, mimeType?, type?, uri?, lastModified? }`. A `@sigx/lynx-file-picker` asset is one as-is. |
| `FileUpload.Root` `pick` | `({ accept, multiple, types }) => files \| Promise<files>` | — | Opens the platform picker. `types` holds `accept`'s MIME entries, the list `FilePicker.pick` takes. Resolve to `[]` or `null` on cancel. `pickError` fires if it throws or rejects. One pick runs at a time. |
| `FileUpload.Root` `accept` / `multiple` | `string` / `boolean` | — / `false` | `multiple` appends across picks, deduped by `uri` (else name + size + lastModified). Single mode replaces. |
| `FileUpload.Root` `maxFiles` / `minFileSize` / `maxFileSize` / `validate` | `number` / `(file) => code(s) \| null` | — | Checked on every candidate. Refused files never join the model. `filesReject` reports them once per pick as `{ file, errors }[]`, where `errors` are `invalid-type`, `too-large`, `too-small`, `too-many` or your codes. |
| `FileUpload.Root` `disabled` / `invalid` / `required` / `color` / `size` | `boolean` / skin axes | the enclosing Field's | Inside a `Field.Root` the field's flags apply, and a tap on its label opens the picker. |
| `FileUpload.Trigger` / `Dropzone` / `Label` | — | — | Each opens the picker on a tap. The trigger is a `button`-trait view, and `label` names it when its content is not text. |
| `FileUpload.Item` `file` / `invalid` | `FileUploadFile` / `boolean` | — | `invalid` is for an app rendering a rejected file through Item. |
| `FileUpload.ItemName` / `ItemSize` | — | the file's name / `1.5 kB` | `<text>` parts. Children replace the default. The name ellipsizes on one line. In a narrow row only the name gives way: the daisy skin keeps the size and the × at their content width (#1294, [signalxjs/zero#522](https://github.com/signalxjs/zero/pull/522), with the next zero bump). |
| `FileUpload.ItemRemove` / `ClearTrigger` `label` | `string` | `"Remove <name>"` / `"Clear files"` | With no children, Remove draws `×`. ClearTrigger renders nothing while the model is empty. |
| `Chat.Root` `placement` | `'start' \| 'end'` | `'start'` | `start` is the other party, and `end` is your own rows. `color` / `size` paint the bubble. |
| `Chat.Root` `avatarGap` | `number` (px) | `8` | The room kept between the avatar and the column. |
| `Chat.Avatar` / `Header` / `Bubble` / `Footer` | — | — | Avatar is a slot, so put zero's `Avatar` or an `<image>` in it. The other three wrap a string in a `<text>`. |
| `ChatLog.Root` `model:following` / `defaultFollowing` | `boolean` | `true` | Whether the log follows its tail. `followingChange` fires on change. Writing `true` jumps to the end. |
| `ChatLog.Root` `threshold` / `label` / `color` / `size` | `number` / `string` / skin axes | `24` | `threshold` is the distance from the end, in px, that still counts as at the end. `label` names the scroller for the reader. Give the root a height through `class` or a flex parent. |
| `ChatLog.Content` | — | — | The rows go here. It renders the native scroller. |
| `ChatLog.JumpTrigger` `label` | `string` | `"Jump to latest"` | Its name, and its text when it has no children. It is only mounted while the log is not following. |

How they behave on lynx:

- **The picker is the app's.** Lynx has no `<input type="file">`, so the
  `input` part is not rendered and the root takes a `pick` callback.
  lynx-zero takes no native dependency. Wire `@sigx/lynx-file-picker` as
  above, `@sigx/lynx-image-picker` for photos, or any other source.
  Constraints run on whatever the picker returns, because not every picker
  filters by type. There is no form to post to and no constraint
  validation, so `invalid` is yours to set.
- **Drag-and-drop is web-only.** A phone has no desktop to drag from. The
  Dropzone is a large tap target for the picker, and the `highlighted` flag
  (root and dropzone) is never driven. It is reachable through
  `ForceStates` only.
- **Chat placement is the root's.** `zx-p-start` / `zx-p-end` is stamped
  on the root only, as the anatomy declares. The skin aligns the column and
  squares the bubble's tail corner from there, with physical corners
  because lynx has no RTL flow. Lynx has no grid, so the avatar is taken
  out of flow and pinned to the row's bottom corner on the placement's
  side. The root measures it and reserves its width plus `avatarGap`
  beside the column, so an Avatar of any size sits clear of the bubble.
  The reservation is in whole pixels, and a re-measure within a pixel is
  ignored. On iOS, layout snaps the avatar's height by a third of a point
  as the reservation moves it, and chasing that jitter looped until the
  engine's event limit tripped.
- **ChatLog follows its tail.** The root is the frame, and Content renders
  a native vertical `scroll-view` with the rows inside it. While following,
  every change in the content's height scrolls to the end through the
  scroll-view's `scrollTo` method, re-checked a few times in case native
  has not laid the new row out yet. Scrolling up more than `threshold`
  lets go, and the jump trigger appears floating over the frame's foot.
  Scrolling back to the end, or tapping the trigger, follows again. The
  trigger's dock never takes a tap meant for the rows.
- **Not carried:** drag-and-drop, `directory` and `capture` (the picker
  decides), form participation (`name` / `form`), the log's `role="log"`
  live region (lynx has none), anchoring rows prepended above the reader
  ("load earlier"), a short transcript gathering at the foot, `asChild`
  on the chat row and the jump trigger, and keyboard focus. `focus-visible`
  is reachable through `ForceStates` only, as on every lynx-zero part.

## What comes next

The compiled design-system shells (`@sigx/lynx-zero-daisyui`) and the
showcase pilot screens land in the remaining PRs of #1029.
