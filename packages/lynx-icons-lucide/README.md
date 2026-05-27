# @sigx/lynx-icons-lucide

[Lucide](https://lucide.dev/) adapter for [`@sigx/lynx-icons`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-icons). Reads icon data from the official `lucide` package and renders each glyph as a stroked SVG with the wrapper attributes (`fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, rounded caps/joins) that match the Lucide design.

SVG-mode only — Lucide isn't distributed as a font.

## Install

```bash
pnpm add @sigx/lynx-icons @sigx/lynx-icons-lucide lucide
```

```ts
// signalx.config.ts
import { defineLynxConfig } from '@sigx/lynx-cli/config';

export default defineLynxConfig({
    iconSets: [
        { id: 'lucide', source: '@sigx/lynx-icons-lucide' },
    ],
});
```

## Usage

```tsx
import { Icon } from '@sigx/lynx-icons';

<Icon set="lucide" name="search" />
<Icon set="lucide" name="chevron-right" size={20} color="#0D9488" />
<Icon set="lucide" name="bell" size={24} />
```

Glyph names are kebab-case (`chevron-right`, not `ChevronRight`); the adapter converts to lucide's `ChevronRight` export internally.

## Notes

- Lucide icons are **stroked**, not filled. `color` is substituted into the `stroke` attribute, so passing dark/light colors works the same as it does for filled FA icons.
- The full Lucide catalog is reachable — every PascalCase export is mapped from a kebab-case name. If a name fails to resolve, check the [Lucide icon library](https://lucide.dev/icons/) for the canonical spelling.
- `mode: 'font'` is rejected at config-validation time when v1.1 ships — Lucide has no source TTF.

## Dynamic / JSON-driven icons

If the icon `name` comes from data the build-time scanner can't see, set `include: ['*']` on the iconSet to ship the entire Lucide catalog:

```ts
iconSets: [
    { id: 'lucide', source: '@sigx/lynx-icons-lucide', include: ['*'] },
],
```

This bundles all ~1 500 Lucide glyphs into the JS bundle. Use it per-set, only when needed.

## API

```ts
import lucideAdapter from '@sigx/lynx-icons-lucide';

lucideAdapter.styles;                       // ['']  (single empty-string style)
lucideAdapter.getGlyph('', 'user');         // { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="__COLOR__"…>' }
lucideAdapter.getFontPath('');              // null (always)
```

The adapter is normally consumed by `@sigx/lynx-plugin`'s icons slice — these direct exports are useful for tests and custom tooling.

## Reference app

[`examples/showcase/src/screens/Settings.tsx`](https://github.com/signalxjs/lynx/blob/main/examples/showcase/src/screens/Settings.tsx) renders `<Icon set="lucide" name="search" />` and `<Icon set="lucide" name="bell" />` alongside FA glyphs in a card.
