import { component } from '@sigx/lynx';
import type { IconSpec } from '@sigx/lynx-icons';
import { Tabs, Stack } from '@sigx/lynx-navigation';
import { NavDrawer, NavHeader, NavTabBar } from '@sigx/lynx-daisyui';
import { ShowcaseMenu } from './ShowcaseMenu.js';

// Shared back chevron spec for all per-tab stacks.
const backChevron: IconSpec = { set: 'lucide', name: 'chevron-left' };

// Each <Tabs.Screen> hosts its own <Stack initialRoute=…>, so a card push
// from inside a tab (e.g. tripsHome → tripDetail) stays inside that tab's
// stack. Routes declared `presentation: 'modal'` escalate up to the root
// navigator automatically and overlay the entire tabs UI.
//
// Each per-tab Stack mounts its own <NavHeader /> as a persistent bar
// above the screen-transition wrapper — iOS-style. The bar stays in
// place during push/pop slides while its *contents* (title, back
// button, right items) update to the destination screen's chrome.
// `useScreenChrome()` is transition-aware: it reads the *destination*
// entry's options/slots, so the bar reflects what the user is
// navigating *to* immediately — no end-of-animation snap and no
// double-header sliding through the viewport.
//
// Modal screens (NewTrip / NewEntry) render their own NavHeader inside
// their body — those don't go through a per-tab Stack and need the
// header to slide up with the modal sheet.
export const RootTabs = component(() => {
    return () => (
        <NavDrawer slots={{ sidebar: () => <ShowcaseMenu /> }}>
            <Tabs initialTab="trips">
                <Tabs.Screen name="trips" label="Trips" icon={{ set: 'lucide', name: 'map' }}>
                    <Stack initialRoute="tripsHome">
                        <NavHeader backIcon={backChevron} />
                    </Stack>
                </Tabs.Screen>
                <Tabs.Screen name="map" label="Map" icon={{ set: 'lucide', name: 'compass' }}>
                    <Stack initialRoute="mapHome">
                        <NavHeader backIcon={backChevron} />
                    </Stack>
                </Tabs.Screen>
                <Tabs.Screen name="settings" label="Settings" icon={{ set: 'lucide', name: 'settings' }}>
                    <Stack initialRoute="settingsHome">
                        <NavHeader backIcon={backChevron} />
                    </Stack>
                </Tabs.Screen>
                <NavTabBar />
            </Tabs>
        </NavDrawer>
    );
});
