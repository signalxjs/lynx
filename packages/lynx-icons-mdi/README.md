# @sigx/lynx-icons-mdi

[Material Design Icons](https://pictogrammers.com/library/mdi/) adapter for [`@sigx/lynx-icons`](https://sigx.dev/lynx/modules/icons/overview/). Reads path data from the official `@mdi/js` package and renders each glyph as a single filled SVG path (`viewBox="0 0 24 24"`, `fill="currentColor"`).

SVG-mode only — `@mdi/js` ships path data, not a font. Only the glyphs your app renders end up in the bundle; `@mdi/js` itself is read at build time and never shipped.

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/icons-mdi/overview/](https://sigx.dev/lynx/modules/icons-mdi/overview/)**

## Install

```bash
pnpm add @sigx/lynx-icons @sigx/lynx-icons-mdi @mdi/js
```

```ts
// signalx.config.ts
import { defineLynxConfig } from '@sigx/lynx-cli/config';

export default defineLynxConfig({
    iconSets: [
        { id: 'mdi', source: '@sigx/lynx-icons-mdi' },
    ],
});
```

## Usage

### Pinned component (recommended)

```tsx
import { MdiIcon } from '@sigx/lynx-icons-mdi/components';

<MdiIcon name="menu" />
<MdiIcon name="signal-cellular-outline" size={24} />
<MdiIcon name="battery-50" size={20} color="#0D9488" />
```

`MdiIcon` is a thin wrapper around `<Icon>` from `@sigx/lynx-icons` with `set="mdi"` pre-filled. Rendering, color sanitization, and theming behavior are identical to the generic form.

### Generic `<Icon>` (dynamic `set` / non-conventional ids)

```tsx
import { Icon } from '@sigx/lynx-icons';

<Icon set="mdi" name="menu" />
<Icon set="mdi" name="signal-cellular-outline" size={24} />
```

Glyph names are MDI's kebab-case names (`signal-cellular-outline`, not `mdiSignalCellularOutline`) — the same names shown on the [MDI library](https://pictogrammers.com/library/mdi/). The adapter converts to the `@mdi/js` export internally.

## Notes

- MDI icons are **filled** single paths. `color` (or the theme's variant color) replaces `currentColor`.
- There are no per-icon components (`MdiMenu`, …): one `MdiIcon` with a `name` keeps the API identical to the other adapters and lets the build-time scanner subset by name.
- `MdiIcon` hard-codes the set id `mdi`. If you register the set under another id, use `<Icon set="…">`.

## Dynamic / JSON-driven icons

If the icon `name` comes from data the build-time scanner can't see, list the names in `include`:

```ts
iconSets: [
    { id: 'mdi', source: '@sigx/lynx-icons-mdi', include: ['wifi', 'wifi-off'] },
],
```

`include: ['*']` ships the entire catalog (7 400+ glyphs, ~2.7 MB of path data) — avoid it unless you really need arbitrary names.

## API

```ts
import mdiAdapter from '@sigx/lynx-icons-mdi';

mdiAdapter.styles;                       // ['']  (single empty-string style)
mdiAdapter.getGlyph('', 'menu');         // { svg: '<svg … viewBox="0 0 24 24" fill="currentColor"><path d="…"/></svg>' }
mdiAdapter.getFontPath('');              // null (always)
mdiAdapter.listGlyphs('');               // ['ab-testing', 'abacus', …]
```

The adapter is normally consumed by `@sigx/lynx-plugin`'s icons slice — these direct exports are useful for tests and custom tooling.

## Reference app

[`examples/showcase/src/screens/Icons.tsx`](https://github.com/signalxjs/lynx/blob/main/examples/showcase/src/screens/Icons.tsx) renders a row of `<MdiIcon>` glyphs (menu, cellular signal, wifi, battery, bluetooth) themed with daisy variants.

## License

MIT. The icons themselves come from `@mdi/js` and are licensed under Apache-2.0 by Pictogrammers.
