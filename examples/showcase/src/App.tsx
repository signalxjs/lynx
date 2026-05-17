import { component } from '@sigx/lynx';
import { NavigationRoot, Stack } from '@sigx/lynx-navigation';
import { NavHeader } from '@sigx/lynx-daisyui';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';
import { ThemeProvider } from './lib/theme.js';
import { routes } from './routes.js';

// SafeAreaProvider defaults to `height: 100vh + flex column`, and
// SafeAreaView defaults to flex-fill — so the layout chain is now
// boilerplate-free. ThemeProvider just slots in for the daisy theme.
const App = component(() => () => (
    <SafeAreaProvider>
        <ThemeProvider initial="daisy-light">
            <SafeAreaView edges={['top', 'bottom']} class="bg-base-100">
                <NavigationRoot routes={routes} initialRoute="root">
                    <NavHeader />
                    <Stack />
                </NavigationRoot>
            </SafeAreaView>
        </ThemeProvider>
    </SafeAreaProvider>
));

export default App;
