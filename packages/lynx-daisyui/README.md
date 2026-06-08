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
            <Button color="primary">Sign in</Button>
        </Card>
    );
}
```

The full component surface lives under `src/{buttons,data,feedback,forms,layout,navigation,typography}` — see the package source for the current inventory.

## Form controls — two-way binding

The form controls (`Input`, `Textarea`, `Checkbox`, `Toggle`, `Select`, `Radio.Item`)
bind with the sigx [`model`](https://sigx.dev/core/docs/two-way-binding) getter
syntax — `model={() => state.field}`. Interacting with the control writes the new
value straight back into the bound signal; no `onChange` plumbing required.

```tsx
import { signal } from '@sigx/lynx';
import { Checkbox, Toggle, Select, Radio, Input } from '@sigx/lynx-daisyui';

const form = signal({ name: '', agreed: false, dark: false, role: 'design' });
const plan = signal('free');
const roles = [
    { label: 'Design', value: 'design' },
    { label: 'Engineering', value: 'eng' },
];

<Input model={() => form.value.name} />
<Checkbox model={() => form.value.agreed} />
<Toggle model={() => form.value.dark} />
<Select options={roles} model={() => form.value.role} />

// Radio: bind every item in the group to the same signal; each carries its
// own `value`. The item whose `value` matches the model renders checked.
<Radio>
    <Radio.Item value="free" label="Free" model={() => plan.value} />
    <Radio.Item value="pro"  label="Pro"  model={() => plan.value} />
</Radio>
```

`Checkbox`/`Toggle` also accept a static `checked` prop **and** an `onChange`
event for controlled (non-model) usage. `Select`/`Radio.Item` take a static
`value`/`checked` as **display-only** initial state — they have no change
callback (a prop named `value` collides with runtime-core's `emit` handler
lookup, so events on them never fire), so use `model` for any interactivity.
When a `model` is bound it always takes precedence over the static prop.

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

### Two layers: content vs. OS chrome

A theme drives two different things, and they scope differently:

1. **In-app content** — the `--color-*` / radius variables and icon
   tints. These live on a host view and inherit down a subtree, so they
   are genuinely *scopable*.
2. **OS chrome** — the status- and navigation-bar tint (pushed by
   `<StatusBarSync>`). This is a global OS singleton; it can only reflect
   one theme at a time.

The rule:

> `useTheme()` is the theme for the **content you render** — the nearest
> `<ThemeProvider>`, or the app-global theme at the root / in headless
> code. **System chrome always follows the global theme.** `StatusBarSync`
> binds to the global controller, so a nested provider can't hijack the
> bars.
>
> *Scopes recolor pixels you draw; only the global theme touches the OS.*

This mirrors Flutter, where `Theme` nests freely for content while system
chrome goes through a separate channel (`AnnotatedRegion`/`SystemChrome`).

### Headless control (no provider required)

The active theme lives in a module-level singleton, so you can read and
set it from anywhere — a store, a service, app-boot logic, an effect —
without a mounted `<ThemeProvider>` ancestor. `useTheme()` resolves to
this same controller when no provider is in scope (it never throws).

```tsx
import { themeController } from '@sigx/lynx-daisyui';

// From any non-component module:
themeController.set('daisy-dark');
themeController.toggle();
themeController.followSystem();
themeController.name;            // current selection
```

A mounted root `<ThemeProvider>` binds this singleton, so headless
mutations render and the OS bars follow.

### Per-screen themes

Different screens can use different themes — and the status-bar icons
follow the active screen so they stay legible. Because this drives the
**global** theme, the bars update automatically:

```tsx
import { useScreenTheme } from '@sigx/lynx-zero/screen-theme';

const Gallery = component(() => {
    useScreenTheme('daisy-dark'); // dark (incl. status bar) while focused; restored on blur
    return () => <view>…</view>;
});
```

`useScreenTheme` is built on `@sigx/lynx-navigation`'s `useFocusEffect`
(an optional peer) and must be called from a routed screen.

### Scoped sub-overrides

To recolor just a **region** without touching the OS bars, nest a
`<ThemeProvider>`. Its subtree (content + icons) re-themes; the status
bar stays on the global theme.

```tsx
<ThemeProvider initial="daisy-light">
    <App />
    {/* this card renders synthwave; the status bar stays light */}
    <ThemeProvider initial="daisy-synthwave">
        <PreviewCard />
    </ThemeProvider>
</ThemeProvider>
```

## Navigation chrome

Two daisy-themed components that pair with
[`@sigx/lynx-navigation`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-navigation). Both read state via the
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

### `<SwiperIndicator>`

Themed wrapper around the headless `useSwiperDot*` hooks from
[`@sigx/lynx-gestures`](https://github.com/signalxjs/lynx/tree/main/packages/lynx-gestures#swiper-and-headless-dot-hooks).
Reads colours from the active daisy theme so the indicator follows light
/ dark mode automatically.

```tsx
import { Swiper } from '@sigx/lynx-gestures';
import { SwiperIndicator } from '@sigx/lynx-daisyui';

<Swiper offset={offset} index={pageIdx} width={pageWidth}>{pages}</Swiper>
<SwiperIndicator
  variant="dots"
  count={pages.length}
  offset={offset}
  pageWidth={pageWidth}
  index={pageIdx}
  color="primary"
  onDotPress={(i) => { pageIdx.value = i }}
/>
```

| Variant       | Animated channel             | Notes                                                              |
| ------------- | ---------------------------- | ------------------------------------------------------------------ |
| `dots`        | `opacity` crossfade          | Default. Two-colour overlay per dot.                               |
| `bar`         | `translateX` (single thumb)  | One MT binding regardless of page count — cheapest for long lists. |
| `pill`        | `scaleX` + `opacity`         | Active dot stretches into a pill while overlay fades in.           |
| `scale-pulse` | uniform `scale`              | Monochrome pulse — no colour crossfade.                            |
| `numbered`    | none (BG-thread text)        | Renders `n / total`. Requires `index` signal.                      |

Props: `count`, `offset` (`SharedValue<number>`), `pageWidth`, `index`
(`PrimitiveSignal<number>`, required for `numbered`), `color`, `inactiveColor`
(daisy tokens), `size` (`'xs' | 'sm' | 'md' | 'lg'`), `onDotPress`.

For a non-standard visual, skip this component and call the headless
hooks directly — they're the same primitives this component composes.

## Layout primitives

Daisy's flex primitives (`Center`, `Col`, `Row`) accept a `flex={n}`
prop. The preset rewrites that into the long-form `flex-grow/shrink/
basis: 0` triple, so `flex={1}` actually fills available space instead
of collapsing to content size — the standard Lynx `flex: 1` shorthand
expands to `flex: 1 1 auto` which doesn't do what most people expect.

## Markdown integration

Two bridges into [`@sigx/lynx-markdown`](../lynx-markdown):

```tsx
import { EditorToolbar, daisyToolbarItem, markdownComponents, useMarkdownEditorTheme } from '@sigx/lynx-daisyui';

// Themed rendering: daisyUI typography/colors for every markdown node.
<MarkdownView value={md} components={markdownComponents} />;

// Themed editing: the native <sigx-richtext> element can't read CSS
// variables (and the built-in theme tokens are oklch, which Lynx can't
// parse), so this hook reactively resolves the ACTIVE theme's palette to
// concrete hex color props — a theme switch recolors the editor live.
// Themed toolbar: daisy Buttons over the generic ToolbarItem contract.
// Standalone (shown) or via <MarkdownEditor toolbar renderToolbarItem={daisyToolbarItem} />.
<EditorToolbar controller={ctrl} selection={sel} />;

const editorTheme = useMarkdownEditorTheme();
<MarkdownEditor
  textColor={editorTheme.textColor}               // base-content
  accentColor={editorTheme.accentColor}           // primary (caret, links)
  placeholderColor={editorTheme.placeholderColor} // base-content @ 40%
/>;
```

## Status

Initial release — APIs may shift as the Lynx styling story evolves.
