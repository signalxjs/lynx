# @sigx/lynx-daisyui

DaisyUI-flavored component library and styles for sigx-lynx. Ships a Tailwind preset, a stylesheet, and the matching JSX components (`Button`, `Input`, `Modal`, `Tabs`, …) so you can build Lynx UIs with the same idiom you'd use in `@sigx/daisyui` on web.

## Install

```bash
pnpm add @sigx/lynx-daisyui
```

## Use the components

```tsx
import { Button, Input, Card } from '@sigx/lynx-daisyui';

export function LoginCard() {
    return (
        <Card>
            <Input placeholder="Email" />
            <Input type="password" placeholder="Password" />
            <Button variant="primary">Sign in</Button>
        </Card>
    );
}
```

The full component surface lives under `src/{buttons,data,feedback,forms,layout,navigation,typography}` — see the package source for the current inventory.

## Use the styles

The package exports a single stylesheet you can pull in from your app entry:

```ts
import '@sigx/lynx-daisyui/styles';
```

This bundles the base reset, theme tokens (light/dark), and per-component CSS. For Tailwind users, the package also ships a preset:

```ts
// tailwind.config.ts
import { daisyuiPreset } from '@sigx/lynx-daisyui/preset';
export default { presets: [daisyuiPreset], /* … */ };
```

## Status

Initial release — APIs may shift as the Lynx styling story evolves.
