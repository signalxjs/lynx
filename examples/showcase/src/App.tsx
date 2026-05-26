import { component } from '@sigx/lynx';
import { AppearanceProvider } from '@sigx/lynx-appearance';
import { StatusBarSync, ThemeProvider } from '@sigx/lynx-daisyui';
import { NavigationRoot, Stack } from '@sigx/lynx-navigation';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';
import { routes } from './routes.js';
// Side-effect import: registers demo runtime custom themes (acme-light/dark)
// into the daisy registry before <ThemeProvider> mounts.
import './themes.js';

// SafeAreaProvider defaults to `height: 100vh + flex column`, and
// SafeAreaView defaults to flex-fill — so the layout chain is now
// boilerplate-free. ThemeProvider just slots in for the daisy theme.
//
// AppearanceProvider feeds ThemeProvider's `followSystem` default: with no
// `initial=` prop, the theme picks `daisy-light` / `daisy-dark` from the
// OS color scheme and live-flips when the user toggles dark mode in
// system settings.
//
// StatusBarSync mirrors the active theme's variant out to the device's
// status- and navigation-bar tint so the system icons stay legible.
//
// No root-level `<NavHeader />` — each screen owns its own chrome.
const App = component(() => () => (
    <AppearanceProvider>
        <SafeAreaProvider>
            <ThemeProvider>
                <StatusBarSync />
                <SafeAreaView edges={['top', 'bottom']} class="bg-base-100">
                    <NavigationRoot routes={routes} initialRoute="root">
                        <Stack />
                    </NavigationRoot>
                </SafeAreaView>
            </ThemeProvider>
        </SafeAreaProvider>
    </AppearanceProvider>
));

export default App;
