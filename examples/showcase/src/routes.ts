import { defineRoutes } from '@sigx/lynx-navigation';
import { z } from 'zod';
import { RootTabs } from './screens/RootTabs.js';
import { TripsList } from './screens/TripsList.js';
import { TripDetail } from './screens/TripDetail.js';
import { TripGuide } from './screens/TripGuide.js';
import { NewTrip } from './screens/NewTrip.js';
import { NewEntry } from './screens/NewEntry.js';
import { ImageViewer } from './screens/ImageViewer.js';
import { Map } from './screens/Map.js';
import { Settings } from './screens/Settings.js';
import { AuthDemo } from './screens/AuthDemo.js';
import { ThemeLab } from './screens/ThemeLab.js';
import { TypographyLab } from './screens/TypographyLab.js';
import { MarkdownLab } from './screens/MarkdownLab.js';
import { MarkdownEditorLab } from './screens/MarkdownEditorLab.js';
import { MarkdownComposerLab } from './screens/MarkdownComposerLab.js';
import { KeyboardLab } from './screens/KeyboardLab.js';

export const routes = defineRoutes({
    root: { component: RootTabs },
    // Per-tab home routes. Each is the bottom entry of its tab's nested
    // <Stack initialRoute=…> — pushing more card routes from these screens
    // stays inside the owning tab; modal routes (newTrip / newEntry) escalate
    // to the root navigator.
    tripsHome: { component: TripsList },
    mapHome: { component: Map },
    settingsHome: { component: Settings },
    authDemo: { component: AuthDemo },
    themeLab: { component: ThemeLab },
    typographyLab: { component: TypographyLab },
    markdownLab: { component: MarkdownLab, path: '/markdown-lab' },
    markdownEditorLab: { component: MarkdownEditorLab, path: '/markdown-editor-lab' },
    markdownComposerLab: { component: MarkdownComposerLab, path: '/markdown-composer-lab', presentation: 'modal' },
    // Modal so the composer demo isn't sitting on top of the tab bar — a bar
    // with extra chrome below it needs `offset` compensation (see KeyboardLab).
    keyboardLab: { component: KeyboardLab, path: '/keyboard-lab', presentation: 'modal' },
    tripDetail: {
        component: TripDetail,
        params: z.object({ tripId: z.string() }),
        path: '/trips/:tripId',
    },
    tripGuide: {
        component: TripGuide,
        params: z.object({ tripId: z.string() }),
        path: '/trips/:tripId/guide',
    },
    newTrip: {
        component: NewTrip,
        presentation: 'modal',
    },
    newEntry: {
        component: NewEntry,
        // `entryId` optional — present → edit mode, absent → create mode.
        params: z.object({
            tripId: z.string(),
            entryId: z.string().optional(),
        }),
        presentation: 'modal',
    },
    imageViewer: {
        component: ImageViewer,
        params: z.object({
            tripId: z.string(),
            entryId: z.string(),
            index: z.number().optional(),
        }),
        presentation: 'fullScreen',
    },
});

declare module '@sigx/lynx-navigation' {
    interface Register {
        routes: typeof routes;
    }
}
