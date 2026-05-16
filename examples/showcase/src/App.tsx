import { component } from '@sigx/lynx';
import { NavigationRoot, Header, Stack } from '@sigx/lynx-navigation';
import { routes } from './routes.js';

const App = component(() => () => (
    <NavigationRoot routes={routes} initialRoute="root">
        <Header />
        <Stack />
    </NavigationRoot>
));

export default App;
