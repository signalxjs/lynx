# @sigx/lynx-daisyui

DaisyUI-flavored component library and styles for sigx-lynx. Ships a Tailwind preset, a stylesheet, and the matching JSX components (`Button`, `Input`, `Modal`, `Tabs`, …) so you can build Lynx UIs with the same idiom you'd use in `@sigx/daisyui` on web.

> **Status — initial release.** APIs may shift as the Lynx styling story evolves.

## 📚 Documentation

Full component catalog, theming, navigation chrome and live examples → **[sigx.dev/lynx/modules/daisyui/overview](https://sigx.dev/lynx/modules/daisyui/overview/)**

## Install

```bash
pnpm add @sigx/lynx-daisyui
```

## A taste

```tsx
import { Button, Input, Card } from '@sigx/lynx-daisyui';

export function LoginCard() {
    return (
        <Card>
            <Input placeholder="Email" />
            <Input type="password" placeholder="Password" />
            <Button color="primary">Sign in</Button>
        </Card>
    );
}
```

Pull in the stylesheet from your app entry, or the Tailwind preset if you use Tailwind:

```ts
import '@sigx/lynx-daisyui/styles';
// or, for Tailwind:
import { daisyuiPreset } from '@sigx/lynx-daisyui/preset';
```

## What's interesting

- **Two-way binding** form controls via the sigx [`model`](https://sigx.dev/core/docs/two-way-binding) getter syntax — no `onChange` plumbing. `Select` and `Radio.Item` additionally accept a plain callback (`onChange` / `onSelect`) for controlled, non-`model` usage; `model` stays the canonical state path and is written before the callback runs, so both can be used together:

  ```tsx
  <Select options={fruits} model={() => state.fruit} onChange={(v) => track('fruit', v)} />
  <Radio.Item value="pro" label="Pro" onSelect={(v) => setPlan(v)} />
  ```
- **Theme switching** with `<ThemeProvider>` / `useTheme()`, a headless `themeController` singleton, per-screen themes, and scoped sub-overrides. Content themes nest freely; OS chrome (status/nav bars) follows the global theme.
- **Navigation chrome** that pairs with [`@sigx/lynx-navigation`](https://sigx.dev/lynx/modules/navigation/overview/) — `<NavTabBar />`, `<NavHeader />`, `<SwiperIndicator>` — all built on the navigation package's public hooks.
- **Markdown integration** bridges into [`@sigx/lynx-markdown`](https://sigx.dev/lynx/modules/markdown/overview/) for themed rendering, editing and toolbar.

Full theming model, component props, and the navigation/markdown bridges are documented on the docs site.

## License

MIT
