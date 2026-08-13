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

## Components (the pilot ten)

Progress, Button, Switch, Tabs, Accordion, Dialog, Popover, Toast, Select,
Slider — zero's anatomies rendered in Lynx JSX over the shared behaviors.
The platform spellings to know:

- **Closed means unmounted.** Lynx has no `hidden` attribute and no
  attribute selectors, so inactive panels, closed popups and unchecked
  indicators leave the tree — absence is the lynx spelling of `hiddenIn`.
- **Overlays portal to the outlet.** Wrap the app once in `ZeroRoot` (theme
  host + overlay outlet as the LAST child — stacking is document order).
  Dialog renders the anatomy's `::backdrop` pseudo part as a real view;
  light dismiss routes through the shared layer stack (`dismissTopLayer()`),
  so nested overlays close innermost-first.
- **Select is options-driven** (`options={[{ value, label?, group?, … }]}`,
  zero's `OptionInput` shape); Slider is touch-driven tier 1 — the value
  paints as inline track percentages, the lynx counterpart of the web's
  runtime `--slider-percent`.
- **`@sigx/lynx-zero/testing`** holds components to the same contract as
  the web: `expectAnatomy` (zero's oracle over the rendered tree; pass
  `{ portaled: ['popup'] }` for parts the outlet hosts) and
  `expectClassGrammar` (the classes recomputed from the data attributes).

## What comes next

The compiled design-system shells (`@sigx/lynx-daisyui-zero`) and the
showcase pilot screens land in the remaining PRs of #1029.
