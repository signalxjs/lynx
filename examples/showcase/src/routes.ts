import { defineRoutes } from '@sigx/lynx-navigation';
import { z } from 'zod';
import { Home } from './screens/Home.js';
import { AreaScreen } from './screens/AreaScreen.js';
import { DaisyComponentScreen } from './screens/DaisyComponentScreen.js';
import { HeroUIComponentScreen } from './screens/HeroUIComponentScreen.js';
// UI & Theming
import { Appearance } from './screens/Appearance.js';
import { Theming } from './screens/Theming.js';
import { HeroUILab } from './screens/HeroUILab.js';
import { Foundation } from './screens/Foundation.js';
import { DirectivesDemo } from './screens/DirectivesDemo.js';
import { Icons } from './screens/Icons.js';
import { SystemBars } from './screens/SystemBars.js';
import { SheetDemo } from './screens/SheetDemo.js';
import { ListDemo } from './screens/ListDemo.js';
import { ChatDemo } from './screens/ChatDemo.js';
// Gestures & Motion
import { SpringLab } from './screens/gestures/SpringLab.js';
import { DragSnapDemo } from './screens/gestures/DragSnapDemo.js';
import { SwipeActionsDemo } from './screens/gestures/SwipeActionsDemo.js';
import { CarouselDemo } from './screens/gestures/CarouselDemo.js';
import { GestureLab } from './screens/gestures/GestureLab.js';
import { PressFeedbackDemo } from './screens/gestures/PressFeedbackDemo.js';
import { PinchRotateDemo } from './screens/gestures/PinchRotateDemo.js';
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
import { FilePickerDemo } from './screens/FilePickerDemo.js';
import { HttpDemo } from './screens/HttpDemo.js';
import { LocationDemo } from './screens/LocationDemo.js';
import { ShareDemo } from './screens/ShareDemo.js';
import { DateTimePickerDemo } from './screens/DateTimePickerDemo.js';
import { WebViewDemo } from './screens/WebViewDemo.js';
import { AuthDemo } from './screens/AuthDemo.js';
import { NotificationsDemo } from './screens/NotificationsDemo.js';
import { BackgroundTasks } from './screens/BackgroundTasks.js';
import { StorageDemo } from './screens/StorageDemo.js';
import { SqliteChatDemo } from './screens/SqliteChatDemo.js';
import { HapticsDemo } from './screens/HapticsDemo.js';
import { WebRTCDemo } from './screens/WebRTCDemo.js';
// Framework
import { DynamicImportDemo } from './screens/DynamicImportDemo.js';
// #620 spike — throwaway
import { SnapshotSpikeScreen } from './screens/SnapshotSpike.js';

export const routes = defineRoutes({
    // #620 spike (throwaway branch): spike screen as root for headless runs.
    root: { component: SnapshotSpikeScreen },
    home: { component: Home, path: '/home' },
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
    // Same parametric pattern for the HeroUI component reference pages —
    // the registry (src/heroui/registry.ts) is the data source.
    heroui: {
        component: HeroUIComponentScreen,
        params: z.object({ componentId: z.string() }),
        path: '/heroui/:componentId',
    },

    // UI & Theming
    listDemo: { component: ListDemo, path: '/list' },
    chatDemo: { component: ChatDemo, path: '/chat' },
    appearance: { component: Appearance, path: '/appearance' },
    theming: { component: Theming, path: '/theming' },
    herouiLab: { component: HeroUILab, path: '/heroui-lab' },
    foundation: { component: Foundation, path: '/foundation' },
    directives: { component: DirectivesDemo, path: '/directives' },
    icons: { component: Icons, path: '/icons' },
    systemBars: { component: SystemBars, path: '/system-bars' },
    // Bottom sheet: the route IS the sheet — pushing it slides the demo
    // screen up to its 0.4 snap point over the dimmed catalog.
    sheetDemo: { component: SheetDemo, path: '/sheet', presentation: 'sheet' },

    // Gestures & Motion
    springLab: { component: SpringLab, path: '/gestures/spring-lab' },
    dragSnap: { component: DragSnapDemo, path: '/gestures/drag-snap' },
    swipeActions: { component: SwipeActionsDemo, path: '/gestures/swipe-actions' },
    carousel: { component: CarouselDemo, path: '/gestures/carousel' },
    gestureLab: { component: GestureLab, path: '/gestures/gesture-lab' },
    pressFeedback: { component: PressFeedbackDemo, path: '/gestures/press-feedback' },
    pinchRotate: { component: PinchRotateDemo, path: '/gestures/pinch-rotate' },

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
    // #620 spike — throwaway
    snapshotSpike: { component: SnapshotSpikeScreen, path: '/snapshot-spike' },

    // Native modules
    mapsDemo: { component: MapsDemo, path: '/maps' },
    mediaDemo: { component: MediaDemo, path: '/media' },
    filePickerDemo: { component: FilePickerDemo, path: '/file-picker' },
    httpDemo: { component: HttpDemo, path: '/http' },
    locationDemo: { component: LocationDemo, path: '/location' },
    shareDemo: { component: ShareDemo, path: '/share' },
    datetimePickerDemo: { component: DateTimePickerDemo, path: '/datetime-picker' },
    webviewDemo: { component: WebViewDemo, path: '/webview' },
    authDemo: { component: AuthDemo, path: '/auth' },
    notifications: { component: NotificationsDemo, path: '/notifications' },
    backgroundTasks: { component: BackgroundTasks, path: '/background-tasks' },
    storageDemo: { component: StorageDemo, path: '/storage' },
    sqliteChatDemo: { component: SqliteChatDemo, path: '/sqlite-chat' },
    hapticsDemo: { component: HapticsDemo, path: '/haptics' },
    webrtcDemo: { component: WebRTCDemo, path: '/webrtc' },

    // Framework
    dynamicImportDemo: { component: DynamicImportDemo, path: '/dynamic-import' },
});

declare module '@sigx/lynx-navigation' {
    interface Register {
        routes: typeof routes;
    }
}
