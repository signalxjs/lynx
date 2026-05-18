import { component } from '@sigx/lynx';
import { ThemeProvider } from '@sigx/lynx-daisyui';
import { NavigationRoot, Stack } from '@sigx/lynx-navigation';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';
import { routes } from './routes.js';

// SafeAreaProvider defaults to `height: 100vh + flex column`, and
// SafeAreaView defaults to flex-fill — so the layout chain is now
// boilerplate-free. ThemeProvider just slots in for the daisy theme.
//
// No root-level `<NavHeader />` — each screen owns its own chrome:
// per-tab Stacks render their own `<NavHeader />` inside `<RootTabs>`,
// and modal screens (NewTrip / NewEntry) render their own NavHeader
// at the top of their JSX body. That way, when a modal slides up, its
// header slides up with it — instead of double-stacking with the
// underneath screen's header at the very top of the viewport.
const App = component(() => () => (
    <SafeAreaProvider>
        <ThemeProvider initial="daisy-light">
            <SafeAreaView edges={['top', 'bottom']} class="bg-base-100">
                <NavigationRoot routes={routes} initialRoute="root">
                    <Stack />
                </NavigationRoot>
            </SafeAreaView>
        </ThemeProvider>
    </SafeAreaProvider>
));

export default App;
