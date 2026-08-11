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
- **Press-feedback defaults** — `PRESSED_SCALE`, `PRESSED_OPACITY`.
- *(Later phases)* layout primitives (`Row`, `Col`, `Center`, `Spacer`,
  `ScrollView`) and the theme engine (`ThemeProvider`, `themeController`,
  theme registry).

What deliberately does **not** live here: visual components, component CSS,
class-name recipes, theme palettes — those are per-design-system.

## License

MIT
