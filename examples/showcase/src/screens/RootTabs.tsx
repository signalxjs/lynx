import { component } from '@sigx/lynx';
import { Tabs, TabBar, Stack, useScreenOptions } from '@sigx/lynx-navigation';

// Each <Tabs.Screen> hosts its own <Stack initialRoute=…>, so a card push
// from inside a tab (e.g. tripsHome → tripDetail) stays inside that tab's
// stack. Routes declared `presentation: 'modal'` escalate up to the root
// navigator automatically and overlay the entire tabs UI.
export const RootTabs = component(() => {
    useScreenOptions({ headerShown: false });

    return () => (
        <Tabs initialTab="trips">
            <Tabs.Screen name="trips" label="Trips">
                <Stack initialRoute="tripsHome" />
            </Tabs.Screen>
            <Tabs.Screen name="map" label="Map">
                <Stack initialRoute="mapHome" />
            </Tabs.Screen>
            <Tabs.Screen name="settings" label="Settings">
                <Stack initialRoute="settingsHome" />
            </Tabs.Screen>
            <TabBar />
        </Tabs>
    );
});
