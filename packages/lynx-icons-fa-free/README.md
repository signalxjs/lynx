# @sigx/lynx-icons-fa-free

[Font Awesome Free](https://fontawesome.com/icons?d=gallery&p=2&m=free) adapter for [`@sigx/lynx-icons`](../lynx-icons). Reads glyph data from the official `@fortawesome/*` packages — no glyph data is re-bundled here, so adapter updates and FA releases stay decoupled.

Supports the three Free styles: **solid**, **regular**, **brands**.

## Install

```bash
pnpm add @sigx/lynx-icons @sigx/lynx-icons-fa-free
pnpm add @fortawesome/fontawesome-free @fortawesome/free-solid-svg-icons
# add the others if you need them:
pnpm add @fortawesome/free-regular-svg-icons @fortawesome/free-brands-svg-icons
```

```ts
// signalx.config.ts
import { defineLynxConfig } from '@sigx/lynx-cli/config';

export default defineLynxConfig({
    iconSets: [
        { id: 'fa',  source: '@sigx/lynx-icons-fa-free', styles: ['solid'] },
        { id: 'fab', source: '@sigx/lynx-icons-fa-free', styles: ['brands'] },
    ],
});
```

Each `iconSets` entry maps to one runtime `set` id. Declare one per style you want to use — they're tree-shaken independently.

## Usage

```tsx
import { Icon } from '@sigx/lynx-icons';

<Icon set="fa" name="user" />
<Icon set="fa" name="chevron-right" size={20} color="#0D9488" />
<Icon set="fab" name="github" size={24} />
```

Glyph names are kebab-case (`chevron-right`, not `chevronRight`). The adapter converts to FA's `faChevronRight` export internally.

## Why FA v6, not v7?

This adapter pins peer FA packages to **`^6`**. Font Awesome v7 dropped TTF distribution — the `webfonts/` directory ships only WOFF2 now, and Lynx Android doesn't support WOFF2. v1 of `@sigx/lynx-icons` doesn't yet use the TTF (SVG mode only), but we keep the peer pinned to v6 so v1.1's font-mode work can land without breaking consumers.

The JS API shape (`{ prefix, iconName, icon: [w, h, _, unicode, path] }`) is stable across v6 and v7, so the glyph lookups themselves would work either way.

## Optional styles

`regular` and `brands` are marked as **optional peerDeps**. If you only need solid, install just `@fortawesome/free-solid-svg-icons` — calls for unknown styles silently resolve to `null` and `<Icon>` renders the missing-glyph placeholder.

## API

```ts
import faAdapter from '@sigx/lynx-icons-fa-free';

faAdapter.styles;                          // ['solid', 'regular', 'brands']
faAdapter.getGlyph('solid', 'user');       // { codepoint: 0xf007, svg: '<svg…>' }
faAdapter.getFontPath('solid');            // absolute path to fa-solid-900.ttf
faAdapter.getGlyph('solid', 'nope-nope');  // null
```

The adapter is normally consumed by `@sigx/lynx-plugin`'s icons slice — these direct exports are useful for tests and custom tooling.

## Reference app

`examples/showcase/src/screens/Settings.tsx` renders `<Icon set="fa" name="user" />`, `house`, `gear`, and `<Icon set="fab" name="github" />` in a card; the build-time scanner picks them up and writes their codepoints into `node_modules/.cache/sigx-lynx-icons/codepoints.mjs`.
