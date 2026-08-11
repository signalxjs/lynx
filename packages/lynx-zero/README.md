# @sigx/lynx-zero

Design-system-neutral UI foundation for sigx-lynx. Design-system packages
(`@sigx/lynx-daisyui`, `@sigx/lynx-heroui`, …) build on it; apps normally
import from their chosen design system, which re-exports what it uses from
here.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/zero/overview/](https://sigx.dev/lynx/modules/zero/overview/)**

What lives here (growing per the phases in
[signalxjs/lynx#219](https://github.com/signalxjs/lynx/issues/219)):

- **The shared contract** (`SizeScale`, `ColorVariant`, `ColorToken`,
  common prop fragments like `WithColor`/`WithDisabled`/`PressEvent`) —
  the vocabulary every design system agrees on, so switching an app from
  one DS to another is mostly an import swap.
- **Token-name conventions** — every theme resolves against the same CSS
  custom-property names (`--color-*`, `--radius-*`, `--size-*`, `--text-*`).
- **Two ways a palette reaches the screen.** A design system's built-ins are
  generated into stylesheet rules at build time and flagged `staticCss` in the
  registry, so the CSS engine resolves them — including the
  `@media (prefers-color-scheme: …)` branch, which means a follow-system app
  paints the OS's scheme whether or not JS agrees. Anything registered at
  runtime — a tenant palette fetched from a backend, an `extendTheme()`
  derivative — has no rule to resolve against, so `<ThemeProvider>` declares
  its exact palette inline instead; that path is unchanged and first-frame
  correct. Set `staticCss` only when the CSS genuinely ships (see
  `scripts/gen-theme-css.mjs`); `extendTheme()` never carries it over.
- **Style utilities** — `resolveBoxStyle`, `resolveSpacing`,
  `resolveColorToken`.
- **Responsive prop values** — `Responsive<T>` / `resolveResponsive` (see
  below).
- **Press-feedback defaults** — `PRESSED_SCALE`, `PRESSED_OPACITY`.
- *(Later phases)* layout primitives (`Row`, `Col`, `Center`, `Spacer`,
  `ScrollView`) and the theme engine (`ThemeProvider`, `themeController`,
  theme registry).

What deliberately does **not** live here: visual components, component CSS,
class-name recipes, theme palettes — those are per-design-system.

## Responsive props

Every style prop on `Row`, `Col`, `Center`, `Spacer` and `ScrollView` accepts
either a plain value or a per-breakpoint object:

```tsx
<Col
    direction={{ initial: 'column', expanded: 'row' }}
    gap={{ initial: 8, large: 16 }}
    padding={{ initial: 16, expanded: 32 }}
/>
```

Keys are core's `WidthClass` tokens, with `initial` naming the `compact` base:
`initial` · `medium` (600dp) · `expanded` (840dp) · `large` (1200dp) ·
`xlarge` (1600dp). Resolution is **mobile-first** — a key applies at its
breakpoint *and every wider one*. A value that defines nothing at or below the
active class resolves to `undefined`, i.e. it behaves exactly like an omitted
prop rather than forcing a zero.

`direction` exists so the stack-on-phone / side-by-side-on-tablet flip restyles
in place. Writing it as `{wide ? <Row/> : <Col/>}` changes the component type
and **remounts the whole subtree** on every rotation, losing child state.

This is plain JS resolution off core's `useWidthClass()` — no Tailwind, no class
names, no CSS pipeline, so it behaves identically under every design system and
under none. It also *has* to be JS: these primitives emit inline styles, and a
stylesheet `@media` rule can never override an inline style.

For your own components, compose the resolver with the singleton class:

```tsx
const cls = useWidthClass();                                    // setup
return () => <Grid columns={resolveResponsive(cols, cls.value) ?? 1} />;
```

There is deliberately no `useResponsive()` hook: it would build a `computed()`
per call site, and `computed()` has no disposer while a signal's subscriber set
holds strong references — so every mount would leak one.

Height is not a key. Branch on it explicitly with core's `useHeightAtLeast()`;
see the note there on why a phone in landscape needs it.

## License

MIT
