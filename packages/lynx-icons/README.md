# @sigx/lynx-icons

`<Icon set name />` for sigx-lynx, with build-time tree-shaking so only the glyphs you actually render ship in the bundle. Pairs with adapter packages — [`@sigx/lynx-icons-fa-free`](../lynx-icons-fa-free) for Font Awesome Free, [`@sigx/lynx-icons-lucide`](../lynx-icons-lucide) for Lucide — and is wired by [`@sigx/lynx-plugin`](../lynx-plugin)'s icons slice.

## Install

```bash
pnpm add @sigx/lynx-icons @sigx/lynx-icons-fa-free
pnpm add @fortawesome/fontawesome-free @fortawesome/free-solid-svg-icons
```

```ts
// sigx.lynx.config.ts
import { defineLynxConfig } from '@sigx/lynx-cli/config';

export default defineLynxConfig({
    iconSets: [
        { id: 'fa', source: '@sigx/lynx-icons-fa-free', styles: ['solid'] },
    ],
});
```

`pnpm dev` / `sigx build` does the rest — `@sigx/lynx-plugin` scans your `.tsx` for `<Icon set= name=>` usages, asks the adapter for each glyph, and writes generated codepoint / SVG maps into `node_modules/.cache/sigx-lynx-icons/`. Unreferenced glyphs are never imported.

## Usage

```tsx
import { Icon } from '@sigx/lynx-icons';

<Icon set="fa" name="user" />
<Icon set="fa" name="house" size={20} color="#0D9488" />
<Icon set="lucide" name="search" size={16} />
```

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `set` | `string` | — | Must match an `iconSets[].id` in `sigx.lynx.config.ts` (or a `defineIconSet({ id, … })` call at runtime). |
| `name` | `string` | — | Glyph name in the set's canonical kebab-case (`chevron-right`, not `chevronRight` / `ChevronRight`). |
| `size` | `number` | `16` | Both width and height, in CSS px. |
| `color` | `string` | `'currentColor'` | Substituted into the SVG template at render time (data: URIs don't reliably inherit `currentColor`). |
| `class` | `string` | — | Forwarded to the host element (`<text>` for font mode, `<image>` for SVG mode, `<view>` for missing glyphs). |

The component renders `<text style={{ fontFamily: setId, … }}>{codepoint}</text>` when a codepoint is available (font mode), or an `<image>` wrapping an SVG data URI otherwise (SVG mode). When neither is registered, an empty `<view>` of the same size renders so layout doesn't jump.

## Dynamic names

The build-time scanner only sees literal `name="…"` strings. Computed names — `<Icon name={state.icon} />` — fall through to the missing-glyph placeholder unless you list them in `iconSets[].include`:

```ts
iconSets: [
    {
        id: 'fa',
        source: '@sigx/lynx-icons-fa-free',
        styles: ['solid'],
        include: ['user', 'house', 'gear'], // force-include for dynamic <Icon name={…}>
    },
],
```

## Custom sets

For one-off in-app icons that don't warrant a full adapter package, use `defineIconSet`:

```ts
import { defineIconSet } from '@sigx/lynx-icons';

defineIconSet({
    id: 'brand',
    glyphs: {
        logo: { svg: { svg: '<svg viewBox="0 0 24 24" fill="__COLOR__"><path d="M3 12L12 3l9 9-9 9z"/></svg>' } },
    },
});

// Anywhere:
<Icon set="brand" name="logo" />
```

`__COLOR__` placeholders in the SVG string get replaced with the user-supplied `color` (or `currentColor`) at render time.

## Writing your own adapter

Adapter packages are plain Node modules with a default export matching this contract:

```ts
import type { IconAdapter } from '@sigx/lynx-icons';

const adapter: IconAdapter = {
    styles: ['solid'],
    getGlyph(style, name) {
        // Return { codepoint?, svg } or null
    },
    getFontPath(style) {
        // Absolute path to a TTF for font-mode subsetting, or null.
    },
};
export default adapter;
```

The plugin dynamically `import()`s the adapter from the consumer's `node_modules` at build start, then calls `getGlyph` for every scanned `<Icon set= name=>` usage. `getFontPath` is reserved for the v1.1 font-subsetting pipeline and can return `null` for SVG-only sets.

## v1 limitations

- **Font mode** (build-time TTF subsetting + base64-inlined `@font-face`) ships in v1.1. v1 renders every glyph as an inline SVG `<image>`. The plumbing for `mode: 'font'` is in the schema but currently no-ops.
- **HMR** for newly-added icon names requires a `pnpm dev` restart. The v1 scanner is a one-shot regex pass at plugin start; v1.1 replaces it with a real SWC-AST Rspack loader.
- **FA Pro** and **Iconify** adapters are v1.1 follow-ups.

## Reference app

`examples/showcase/src/screens/Settings.tsx` shows fa-solid, fa-brands, and lucide icons rendered side by side. The generated cache lives at `examples/showcase/node_modules/.cache/sigx-lynx-icons/` after `pnpm build`.
