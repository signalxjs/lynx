import { component } from '@sigx/lynx';
import { Tabs, Stack, Screen } from '@sigx/lynx-navigation';
import { NavHeader, NavTabBar } from '@sigx/lynx-daisyui';

// Each <Tabs.Screen> hosts its own <Stack initialRoute=…>, so a card push
// from inside a tab (e.g. tripsHome → tripDetail) stays inside that tab's
// stack. Routes declared `presentation: 'modal'` escalate up to the root
// navigator automatically and overlay the entire tabs UI.
//
// No wrapping view needed — `<Tabs.Screen>` uses flex-fill internally,
// so the active screen takes the remaining space alongside `<NavTabBar />`.
export const RootTabs = component(() => {
    // Each per-tab Stack mounts its own <Header /> so that pushes inside
    // the tab (tripsHome → tripDetail) get a back button + title. The
    // root-level <Header /> (in App.tsx) tracks the root nav only, which
    // never changes while we're inside a tab — so without a per-tab Header
    // we'd be stuck with no nav chrome on pushed cards. The root header is
    // suppressed here via `<Screen headerShown={false} />`.
    return () => (
        <Tabs initialTab="trips">
            <Screen headerShown={false} />
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
