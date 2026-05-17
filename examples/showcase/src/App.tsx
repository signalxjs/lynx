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
                {/*
                  `animated={false}` because the SWC worklet loader skips
                  `node_modules/`, so the `'main thread'` directives baked
                  into `@sigx/lynx-motion`'s pre-built dist no-op silently.
                  Without this flag, every push waits 280ms for a slide
                  that never plays — instant snap feels less laggy.
                */}
                <NavigationRoot
                    routes={routes}
                    initialRoute="root"
                    animated={false}
                >
                    <NavHeader />
                    <Stack />
                </NavigationRoot>
            </SafeAreaView>
        </ThemeProvider>
    </SafeAreaProvider>
));

export default App;
