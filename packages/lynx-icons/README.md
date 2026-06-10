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
```

Forcing dynamic names into the bundle (`include: [...]` / `include: ['*']`), one-off `defineIconSet` icons, writing your own adapter, and the x86_64-emulator blank-icon caveat are all documented on the docs site.

## License

MIT
