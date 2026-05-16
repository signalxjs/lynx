import { defineRoutes } from '@sigx/lynx-navigation';
import { z } from 'zod';
import { RootTabs } from './screens/RootTabs.js';
import { TripsList } from './screens/TripsList.js';
import { TripDetail } from './screens/TripDetail.js';
import { NewTrip } from './screens/NewTrip.js';
import { NewEntry } from './screens/NewEntry.js';
import { Map } from './screens/Map.js';
import { Settings } from './screens/Settings.js';

export const routes = defineRoutes({
    root: { component: RootTabs },
    // Per-tab home routes. Each is the bottom entry of its tab's nested
    // <Stack initialRoute=…> — pushing more card routes from these screens
    // stays inside the owning tab; modal routes (newTrip / newEntry) escalate
    // to the root navigator.
    tripsHome: { component: TripsList },
    mapHome: { component: Map },
    settingsHome: { component: Settings },
    tripDetail: {
        component: TripDetail,
        params: z.object({ tripId: z.string() }),
        path: '/trips/:tripId',
    },
    newTrip: {
        component: NewTrip,
        presentation: 'modal',
    },
    newEntry: {
        component: NewEntry,
        params: z.object({ tripId: z.string() }),
        presentation: 'modal',
    },
});

declare module '@sigx/lynx-navigation' {
    interface Register {
        routes: typeof routes;
    }
}
