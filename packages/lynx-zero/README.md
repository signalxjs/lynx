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
- **Style utilities** — `resolveBoxStyle`, `resolveSpacing`,
  `resolveColorToken`.
- **Press-feedback defaults** — `PRESSED_SCALE`, `PRESSED_OPACITY`.
- *(Later phases)* layout primitives (`Row`, `Col`, `Center`, `Spacer`,
  `ScrollView`) and the theme engine (`ThemeProvider`, `themeController`,
  theme registry).

What deliberately does **not** live here: visual components, component CSS,
class-name recipes, theme palettes — those are per-design-system.
