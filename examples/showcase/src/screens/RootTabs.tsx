import { component } from '@sigx/lynx';
import { Tabs, Stack } from '@sigx/lynx-navigation';
import { NavHeader, NavTabBar } from '@sigx/lynx-daisyui';

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
        <Tabs initialTab="trips">
            <Tabs.Screen name="trips" label="Trips">
                <Stack initialRoute="tripsHome">
                    <NavHeader />
                </Stack>
            </Tabs.Screen>
            <Tabs.Screen name="map" label="Map">
                <Stack initialRoute="mapHome">
                    <NavHeader />
                </Stack>
            </Tabs.Screen>
            <Tabs.Screen name="settings" label="Settings">
                <Stack initialRoute="settingsHome">
                    <NavHeader />
                </Stack>
            </Tabs.Screen>
            <NavTabBar />
        </Tabs>
    );
});
