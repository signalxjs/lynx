# @sigx/lynx-heroui

HeroUI-flavored design system for sigx-lynx, built on the
[`@sigx/lynx-zero`](../lynx-zero) foundation. **Pilot scope** while the shared
design-system contract is validated
([signalxjs/lynx#219](https://github.com/signalxjs/lynx/issues/219)) — two
built-in themes (`hero-light` / `hero-dark`) and a representative component
set, growing from there.

```tsx
import { ThemeProvider } from '@sigx/lynx-heroui';
import '@sigx/lynx-heroui/styles';

defineApp(() => () => (
    <ThemeProvider>
        <App />
    </ThemeProvider>
));
```

Components follow the shared contract: semantic `color`
(`primary` … `error`), DS-specific `variant` fill styles
(`solid` / `bordered` / `flat` / `ghost`), `size` on the shared scale, and
sigx conventions (`disabled`, `onPress`). Switching an app between
`@sigx/lynx-daisyui` and `@sigx/lynx-heroui` is mostly an import swap.

Upstream HeroUI token mapping: `danger`→`error`, `default`→`neutral`,
`background`/`content2`/`content3`→`base-100/200/300`,
`foreground`→`base-content`.

## Components

Growing toward `@sigx/lynx-daisyui` parity
([signalxjs/lynx#287](https://github.com/signalxjs/lynx/issues/287)).
Available today:

- **Actions** — `Button`
- **Forms** — `Input`, `Textarea`, `Toggle`, `Checkbox`, `Radio`, `Select`, `FormField`
- **Layout** — `Card`, `Divider`
- **Navigation** — `Tabs`
- **Feedback** — `Modal`
- **Typography** — `Text`, `Heading`

Plus the engine + neutral primitives re-exported from `@sigx/lynx-zero`
(`ThemeProvider`, `useTheme`, `Row`/`Col`/`Center`/`Spacer`/`ScrollView`, …)
so a hero app keeps a single import source.
