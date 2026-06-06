import { defineRoutes } from '@sigx/lynx-navigation';
import { z } from 'zod';
import { Home } from './screens/Home.js';
import { AreaScreen } from './screens/AreaScreen.js';
import { DaisyComponentScreen } from './screens/DaisyComponentScreen.js';
// UI & Theming
import { Appearance } from './screens/Appearance.js';
import { Theming } from './screens/Theming.js';
import { HeroUILab } from './screens/HeroUILab.js';
import { Icons } from './screens/Icons.js';
import { SystemBars } from './screens/SystemBars.js';
// Text & Markdown
import { Markdown } from './screens/Markdown.js';
import { MarkdownEditorScreen } from './screens/MarkdownEditor.js';
import { MarkdownComposerScreen } from './screens/MarkdownComposer.js';
import { TextApis } from './screens/TextApis.js';
// Input & Keyboard
import { Keyboard } from './screens/Keyboard.js';
import { EmojiPickerScreen } from './screens/EmojiPicker.js';
// Native modules
import { MapsDemo } from './screens/MapsDemo.js';
import { MediaDemo } from './screens/MediaDemo.js';
import { LocationDemo } from './screens/LocationDemo.js';
import { ShareDemo } from './screens/ShareDemo.js';
import { WebViewDemo } from './screens/WebViewDemo.js';
import { AuthDemo } from './screens/AuthDemo.js';
import { NotificationsDemo } from './screens/NotificationsDemo.js';
import { BackgroundTasks } from './screens/BackgroundTasks.js';
import { StorageDemo } from './screens/StorageDemo.js';
import { HapticsDemo } from './screens/HapticsDemo.js';

export const routes = defineRoutes({
    // Home is the root of the single global stack: search + grouped catalog.
    root: { component: Home },
    // One parametric route serves every area sub view — the catalog
    // (src/catalog.ts) is the data source, keyed by `areaId`.
    area: {
        component: AreaScreen,
        params: z.object({ areaId: z.string() }),
        path: '/area/:areaId',
    },
    // One parametric route serves every DaisyUI component reference page —
    // the registry (src/daisyui/registry.ts) is the data source, keyed by
    // `componentId`.
    daisyui: {
        component: DaisyComponentScreen,
        params: z.object({ componentId: z.string() }),
        path: '/daisyui/:componentId',
    },

    // UI & Theming
    appearance: { component: Appearance, path: '/appearance' },
    theming: { component: Theming, path: '/theming' },
    herouiLab: { component: HeroUILab, path: '/heroui-lab' },
    icons: { component: Icons, path: '/icons' },
    systemBars: { component: SystemBars, path: '/system-bars' },

    // Text & Markdown
    markdown: { component: Markdown, path: '/markdown' },
    markdownEditor: { component: MarkdownEditorScreen, path: '/markdown-editor' },
    // Modal: the composer's keyboard lift math assumes the bar sits on the
    // bottom inset (same caveat as `keyboard` below).
    markdownComposer: { component: MarkdownComposerScreen, path: '/markdown-composer', presentation: 'modal' },
    textApis: { component: TextApis, path: '/text-apis' },

    // Input & Keyboard — modal so no extra chrome sits below the sticky bar;
    // a bar with chrome below it needs `offset` compensation.
    keyboard: { component: Keyboard, path: '/keyboard', presentation: 'modal' },
    emojiPicker: { component: EmojiPickerScreen, path: '/emoji-picker' },

    // Native modules
    mapsDemo: { component: MapsDemo, path: '/maps' },
    mediaDemo: { component: MediaDemo, path: '/media' },
    locationDemo: { component: LocationDemo, path: '/location' },
    shareDemo: { component: ShareDemo, path: '/share' },
    webviewDemo: { component: WebViewDemo, path: '/webview' },
    authDemo: { component: AuthDemo, path: '/auth' },
    notifications: { component: NotificationsDemo, path: '/notifications' },
    backgroundTasks: { component: BackgroundTasks, path: '/background-tasks' },
    storageDemo: { component: StorageDemo, path: '/storage' },
    hapticsDemo: { component: HapticsDemo, path: '/haptics' },
});

declare module '@sigx/lynx-navigation' {
    interface Register {
        routes: typeof routes;
    }
}
