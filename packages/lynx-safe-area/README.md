# @sigx/lynx-safe-area

Safe-area insets (notch, home indicator, status bar, navigation bar, keyboard) for sigx-lynx. A native publisher on iOS + Android emits insets every time they change; the JS side surfaces them as a reactive BG signal, four per-edge `SharedValue`s for MT-driven layout, and CSS variables for utility-class styling.

Mirrors React Native's `react-native-safe-area-context` API where it makes sense, but built for sigx-lynx's two-thread model so layout-bound insets don't bounce through the bridge.

## 📚 Documentation

Full API, hooks, CSS variables and live examples → **[sigx.dev/lynx/modules/safe-area/overview](https://sigx.dev/lynx/modules/safe-area/overview/)**

## Install

```bash
pnpm add @sigx/lynx-safe-area
```

`sigx prebuild` auto-discovers the package, copies the native `SafeAreaPublisher` into your `ios/` and `android/` trees, and registers it so insets attach to every `LynxView` before first paint. No additional native wiring required.

## A taste

Wrap your app once, anywhere above the views that need insets:

```tsx
import { defineApp } from '@sigx/lynx';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';

defineApp(() => () => (
    <SafeAreaProvider>
        <SafeAreaView edges={['top', 'bottom']} class="bg-base-100">
            <PageContent />
        </SafeAreaView>
    </SafeAreaProvider>
));
```

`<SafeAreaView>` reactively applies the current insets as padding (or margin) to the configured edges, seeded synchronously on first paint so there's no flash of unsafe content. Hooks (`useSafeAreaInsets`, `useSafeAreaSharedValues`, `useSafeAreaFrame`, …), the CSS variables (`--sat`/`--sar`/`--sab`/`--sal`), and the full architecture are documented on the docs site.

## License

MIT
