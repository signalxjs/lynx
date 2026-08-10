# @sigx/lynx-icons

`<Icon set name />` for sigx-lynx, with build-time tree-shaking so only the glyphs you actually render ship in the bundle. Pairs with adapter packages — [`@sigx/lynx-icons-fa-free`](https://sigx.dev/lynx/modules/icons-fa/overview/) for Font Awesome Free, [`@sigx/lynx-icons-lucide`](https://sigx.dev/lynx/modules/icons-lucide/overview/) for Lucide — and is wired by [`@sigx/lynx-plugin`](https://sigx.dev/lynx/modules/plugin/overview/)'s icons slice.

## 📚 Documentation

Full config, dynamic names, custom sets, adapter contract and live examples → **[sigx.dev/lynx/modules/icons/overview](https://sigx.dev/lynx/modules/icons/overview/)**

## Install

```bash
pnpm add @sigx/lynx-icons @sigx/lynx-icons-fa-free
pnpm add @fortawesome/fontawesome-free @fortawesome/free-solid-svg-icons
```

```ts
// signalx.config.ts
import { defineLynxConfig } from '@sigx/lynx-cli/config';

export default defineLynxConfig({
    iconSets: [
        { id: 'fa', source: '@sigx/lynx-icons-fa-free', styles: ['solid'] },
    ],
});
```

`pnpm dev` / `sigx build` does the rest — `@sigx/lynx-plugin` scans your `.tsx` for `<Icon set= name=>` usages, asks the adapter for each glyph, and bundles only the referenced glyphs.

## A taste

```tsx
import { Icon } from '@sigx/lynx-icons';

<Icon set="fa" name="user" />
<Icon set="fa" name="house" size={20} color="#0D9488" />
<Icon set="lucide" name="search" size={16} />
<Icon set="lucide" name="quote" size={16} scaleWithText={true} />
```

### OS font scale

Icons hold their designed `size` (dp) regardless of the system text-size
setting — the layout-stable default for chrome like tab bars and headers
(font-mode glyphs are counter-scaled internally so the engine's text scaling
can't grow them out of their box). For icons sitting inline with scaling
text, pass **`scaleWithText`**: glyph and box grow together by the effective
scale (`useFontScale()`), live, identically on the svg and font backends.

Forcing dynamic names into the bundle (`include: [...]` / `include: ['*']`), one-off `defineIconSet` icons, writing your own adapter, and the x86_64-emulator blank-icon caveat are all documented on the docs site.

## Web

Supported on web (`sigx run:web`) with no extra setup. `<Icon>` renders through Lynx's `<svg content={…}>`, which `@lynx-js/web-core` maps to upstream's `x-svg` element — that turns the inline SVG into a blob URL on an `<img>`, so glyphs paint exactly as bundled. The `signalx-module.json` here only pulls the native XElement/SVG dependency on iOS and Android; a web build has nothing to link and needs no `sigx prebuild`.

As on native, the SVG is parsed in isolation from the host document, so give the icon a concrete `color` (or a theme `variant`, which `<ThemeProvider>` resolves to the palette hex before it reaches `fill=`) rather than relying on `currentColor` or a `var(--token)` inside the markup.

One prop is inert there: **`scaleWithText`**. No web publisher writes `lynx.__globalProps.fontScale`, so `useFontScale()` stays at `1` and the icon keeps its designed `size` whether or not you opt in — the same gap `@sigx/lynx-core` and `@sigx/lynx-appearance` document. Sizing, color/variant and the missing-glyph placeholder are unaffected.

## License

MIT
