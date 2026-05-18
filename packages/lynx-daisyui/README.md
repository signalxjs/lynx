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

The preset also publishes a `.flex-fill` utility class (long-form
`flex-grow/shrink/basis: 0` + `display: flex; flexDirection: column`).
Use it instead of `flex-1` when a Lynx parent's height comes from
flex rather than an explicit percentage — `flex-1` expands to
`flex: 1 1 auto`, which sizes to content and collapses the chain.

## Theme switching

The stylesheet ships two color themes (`daisy-light`, `daisy-dark`)
plus style-modifier themes (`daisy-rounded`, `daisy-flat`). Each is a
CSS class containing scoped `--color-*` / `--radius-*` variables; Lynx
has `enableCSSInheritance: true` in its layout-pipeline defaults so
the variables propagate to every descendant of an element with the
theme class.

`<ThemeProvider>` is a small wrapper that applies the active theme
class to a host view and exposes a controller via `useTheme()`:

```tsx
import { ThemeProvider, useTheme } from '@sigx/lynx-daisyui';

defineApp(() => () => (
    <ThemeProvider initial="daisy-light">
        <App />
    </ThemeProvider>
));

// Anywhere inside:
const theme = useTheme();
theme.toggle();             // daisy-light ↔ daisy-dark
theme.set('daisy-dark');    // explicit
theme.name;                 // 'daisy-light' | 'daisy-dark' | custom string
```

The provider's host view defaults to flex-fill long-form so it doesn't
collapse between a flex parent (`<SafeAreaProvider>`) and a flex child
(`<SafeAreaView>`). Override via `style={…}` if you want a different
layout role. For multi-class compositions (color + modifier),
`theme.set('daisy-light daisy-rounded')` works — the class string is
applied verbatim to the host view.

## Navigation chrome

Two daisy-themed components that pair with
[`@sigx/lynx-navigation`](../lynx-navigation). Both read state via the
navigation package's hooks (no internal-module imports), so swapping
in custom designs later is a one-component change.

### `<NavTabBar />`

Themed bottom tab bar. Drop it inside `<Tabs>` and it picks up the
active tab + tab list via `useTabs()`.

```tsx
import { Tabs } from '@sigx/lynx-navigation';
import { NavTabBar } from '@sigx/lynx-daisyui';

<Tabs initialTab="trips">
    <Tabs.Screen name="trips" label="Trips">…</Tabs.Screen>
    <Tabs.Screen name="map"   label="Map">…</Tabs.Screen>
    <NavTabBar />
</Tabs>
```

| Prop | Default | Notes |
|---|---|---|
| `position` | `'bottom'` | `'top'` flips the separator border to the bottom edge. |
| `background` | `'base-200'` | `'base-100' / 'base-200' / 'base-300' / 'transparent'`. |
| `bordered` | `true` | Show a 1px separator on the edge opposite `position`. |
| `renderTab` | — | `(info, ctx) => JSX` — replace per-tab rendering entirely. |

### `<NavHeader />`

Themed header bar. Drop it inside a `<Stack>` (uses the Stack's
default slot, introduced in `@sigx/lynx-navigation` 1.0) so its
`useNav()` resolves to the per-stack nav:

```tsx
import { Stack } from '@sigx/lynx-navigation';
import { NavHeader } from '@sigx/lynx-daisyui';

<Stack initialRoute="tripsHome">
    <NavHeader />
</Stack>
```

Reads everything it needs via `useScreenChrome()` — title, header-
shown, back-button visibility, and the screen's left/right slot fills.
Renders an ~48dp horizontal bar with the title centred, a "‹ Back"
button on the left when `canGoBack`, and the right slot flush-right.

| Prop | Default | Notes |
|---|---|---|
| `background` | `'base-200'` | Same colour tokens as `NavTabBar`. |
| `bordered` | `true` | Bottom separator line. |
| `renderBack` | — | `({ pop }) => JSX` — replace the default back button. |

For a fully-custom design, build directly on
`useScreenChrome()` from `@sigx/lynx-navigation` — `NavHeader` is just
one consumer of that hook.

## Layout primitives

Daisy's flex primitives (`Center`, `Col`, `Row`) accept a `flex={n}`
prop. The preset rewrites that into the long-form `flex-grow/shrink/
basis: 0` triple, so `flex={1}` actually fills available space instead
of collapsing to content size — the standard Lynx `flex: 1` shorthand
expands to `flex: 1 1 auto` which doesn't do what most people expect.

## Status

Initial release — APIs may shift as the Lynx styling story evolves.
