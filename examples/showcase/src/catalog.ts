import type { RoutesWithoutParams } from '@sigx/lynx-navigation';
import type { IconSpec } from '@sigx/lynx-icons';
import { daisyDemos } from './daisyui/registry.js';
import { heroDemos } from './heroui/registry.js';

/**
 * The example catalog — single source of truth for the Home screen's area
 * list, the per-area sub views, and search. Every example points at a
 * registered route; `route: RoutesWithoutParams` makes a dangling
 * reference a type error (keyed by the Register augmentation in routes.ts)
 * and guarantees `nav.push(example.route)` needs no params — except the
 * DaisyUI and HeroUI component pages, which share the parametric `daisyui`
 * / `heroui` routes respectively and carry their `componentId` in `params`.
 */
export type Example = {
    id: string;
    title: string;
    /** One-liner shown in lists; also matched by search. */
    description: string;
    icon: IconSpec;
} & (
    | { route: RoutesWithoutParams; params?: undefined }
    | { route: 'daisyui'; params: { componentId: string } }
    | { route: 'heroui'; params: { componentId: string } }
);

export interface Area {
    id: string;
    title: string;
    icon: IconSpec;
    examples: Example[];
}

export const catalog: Area[] = [
    {
        id: 'ui-theming',
        title: 'UI & Theming',
        icon: { set: 'lucide', name: 'palette' },
        examples: [
            {
                id: 'list',
                title: 'List',
                description: '10k-item stress test — windowing + load-on-demand over the native <list> recycler',
                icon: { set: 'lucide', name: 'list' },
                route: 'listDemo',
            },
            {
                id: 'chat',
                title: 'Chat',
                description: 'Chat mode — bottom-anchored, stick-to-bottom, unread pill, load-older',
                icon: { set: 'lucide', name: 'message-circle' },
                route: 'chatDemo',
            },
            {
                id: 'appearance',
                title: 'Appearance',
                description: 'Global theme switching, dark toggle, follow-system',
                icon: { set: 'lucide', name: 'sun-moon' },
                route: 'appearance',
            },
            {
                id: 'theming',
                title: 'Theming',
                description: 'Per-screen theme override + nested ThemeProvider scope',
                icon: { set: 'lucide', name: 'paintbrush' },
                route: 'theming',
            },
            {
                id: 'heroui-lab',
                title: 'HeroUI Lab',
                description: 'Second design system on the lynx-zero foundation — A/B vs daisy',
                icon: { set: 'lucide', name: 'layers' },
                route: 'herouiLab',
            },
            {
                id: 'foundation',
                title: 'Foundation (lynx-zero)',
                description: 'The neutral layer under both design systems — contract, theme engine, layout primitives',
                icon: { set: 'lucide', name: 'layers-2' },
                route: 'foundation',
            },
            {
                id: 'directives',
                title: 'Directives (use:show)',
                description: 'use:show — toggle visibility without unmount/remount; preserves state',
                icon: { set: 'lucide', name: 'eye' },
                route: 'directives',
            },
            {
                id: 'icons',
                title: 'Icons',
                description: 'Font Awesome + Lucide adapters, themed and dynamic names',
                icon: { set: 'lucide', name: 'shapes' },
                route: 'icons',
            },
            {
                id: 'system-bars',
                title: 'System bars',
                description: 'Raw status/navigation-bar styling APIs',
                icon: { set: 'lucide', name: 'panel-top' },
                route: 'systemBars',
            },
            {
                id: 'bottom-sheet',
                title: 'Bottom sheet',
                description: 'presentation: "sheet" — snap points, backdrop, drag-to-dismiss',
                icon: { set: 'lucide', name: 'panel-bottom' },
                route: 'sheetDemo',
            },
        ],
    },
    {
        id: 'gestures-motion',
        title: 'Gestures & Motion',
        icon: { set: 'lucide', name: 'hand' },
        examples: [
            {
                id: 'spring-lab',
                title: 'Spring Lab',
                description: 'Interactive spring physics — tune stiffness/damping/mass, race presets',
                icon: { set: 'lucide', name: 'activity' },
                route: 'springLab',
            },
            {
                id: 'drag-snap',
                title: 'Drag & Snap',
                description: 'Draggable with bounds — fling to a corner with velocity handoff',
                icon: { set: 'lucide', name: 'move' },
                route: 'dragSnap',
            },
            {
                id: 'swipe-actions',
                title: 'Swipe Actions',
                description: 'Email-style swipeable rows — archive, flag, delete',
                icon: { set: 'lucide', name: 'inbox' },
                route: 'swipeActions',
            },
            {
                id: 'carousel',
                title: 'Carousel',
                description: 'Swiper with parallax, scale pop and animated dot indicators',
                icon: { set: 'lucide', name: 'gallery-horizontal' },
                route: 'carousel',
            },
            {
                id: 'gesture-lab',
                title: 'Gesture Lab',
                description: 'Race / Simultaneous / Exclusive composition with a live event feed',
                icon: { set: 'lucide', name: 'git-merge' },
                route: 'gestureLab',
            },
            {
                id: 'press-feedback',
                title: 'Press Feedback',
                description: 'Pressable gallery — opacity/scale feedback, long-press, cancel',
                icon: { set: 'lucide', name: 'pointer' },
                route: 'pressFeedback',
            },
            {
                id: 'pinch-rotate',
                title: 'Pinch & Rotate',
                description: 'Two-finger pinch/zoom and rotation on a photo card',
                icon: { set: 'lucide', name: 'maximize-2' },
                route: 'pinchRotate',
            },
        ],
    },
    {
        // Component reference — one page per @sigx/lynx-daisyui component,
        // generated from the registry so adding a demo module is the only
        // step to get a new page, list row, and search entry.
        id: 'daisyui',
        title: 'DaisyUI components',
        icon: { set: 'lucide', name: 'component' },
        examples: daisyDemos.map((demo) => ({
            id: `daisy-${demo.id}`,
            title: demo.title,
            description: demo.description,
            icon: demo.icon,
            route: 'daisyui' as const,
            params: { componentId: demo.id },
        })),
    },
    {
        // Same registry-driven pattern as the DaisyUI area — the second
        // design system on the lynx-zero foundation gets the same first-class
        // per-component reference pages (epic #287).
        id: 'heroui',
        title: 'HeroUI components',
        icon: { set: 'lucide', name: 'layers' },
        examples: heroDemos.map((demo) => ({
            id: `hero-${demo.id}`,
            title: demo.title,
            description: demo.description,
            icon: demo.icon,
            route: 'heroui' as const,
            params: { componentId: demo.id },
        })),
    },
    {
        id: 'text-markdown',
        title: 'Text & Markdown',
        icon: { set: 'lucide', name: 'file-text' },
        examples: [
            {
                id: 'markdown',
                title: 'Markdown renderer',
                description: 'GFM rendering + token-by-token streaming',
                icon: { set: 'lucide', name: 'file-code' },
                route: 'markdown',
            },
            {
                id: 'markdown-editor',
                title: 'Markdown editor',
                description: 'WYSIWYG editing with toolbar, plugins and round-trip preview',
                icon: { set: 'lucide', name: 'pencil' },
                route: 'markdownEditor',
            },
            {
                id: 'markdown-composer',
                title: 'Markdown composer',
                description: 'Chat-style composer riding the soft keyboard',
                icon: { set: 'lucide', name: 'message-square' },
                route: 'markdownComposer',
            },
            {
                id: 'text-apis',
                title: 'Text APIs',
                description: 'Selectable text + useElementLayout measurement',
                icon: { set: 'lucide', name: 'text-cursor' },
                route: 'textApis',
            },
        ],
    },
    {
        id: 'input-keyboard',
        title: 'Input & Keyboard',
        icon: { set: 'lucide', name: 'keyboard' },
        examples: [
            {
                id: 'keyboard',
                title: 'Keyboard',
                description: 'KeyboardAvoidingView + KeyboardStickyView chat pattern',
                icon: { set: 'lucide', name: 'keyboard' },
                route: 'keyboard',
            },
            {
                id: 'emoji-picker',
                title: 'Emoji picker',
                description: 'Searchable emoji grid with skin tones, recents and a sheet wrapper',
                icon: { set: 'lucide', name: 'smile' },
                route: 'emojiPicker',
            },
            {
                id: 'snapshot-spike',
                title: '620 Spike',
                description: 'THROWAWAY: MT snapshot-template cell construction benchmark',
                icon: { set: 'lucide', name: 'zap' },
                route: 'snapshotSpike',
            },
        ],
    },
    {
        id: 'native',
        title: 'Native modules',
        icon: { set: 'lucide', name: 'smartphone' },
        examples: [
            {
                id: 'maps',
                title: 'Maps',
                description: 'MapView with markers and user location',
                icon: { set: 'lucide', name: 'map' },
                route: 'mapsDemo',
            },
            {
                id: 'media',
                title: 'Media',
                description: 'Camera capture, image/video picker, voice notes, video playback',
                icon: { set: 'lucide', name: 'image' },
                route: 'mediaDemo',
            },
            {
                id: 'files',
                title: 'Files',
                description: 'Generic file picker + binary read round-trip',
                icon: { set: 'lucide', name: 'file' },
                route: 'filePickerDemo',
            },
            {
                id: 'http',
                title: 'Fetch',
                description: 'Global fetch — GET JSON + multipart upload with progress',
                icon: { set: 'lucide', name: 'globe' },
                route: 'httpDemo',
            },
            {
                id: 'location',
                title: 'Location',
                description: 'Permission request + one-shot GPS fix',
                icon: { set: 'lucide', name: 'map-pin' },
                route: 'locationDemo',
            },
            {
                id: 'share',
                title: 'Share',
                description: 'Native share sheet for text and URLs',
                icon: { set: 'lucide', name: 'share-2' },
                route: 'shareDemo',
            },
            {
                id: 'datetime-picker',
                title: 'Date & time picker',
                description: 'Native date / time / datetime pickers',
                icon: { set: 'lucide', name: 'calendar-clock' },
                route: 'datetimePickerDemo',
            },
            {
                id: 'webview',
                title: 'WebView',
                description: 'Embedded browser with back/forward/reload',
                icon: { set: 'lucide', name: 'globe' },
                route: 'webviewDemo',
            },
            {
                id: 'auth',
                title: 'Biometric auth',
                description: 'Face ID / Touch ID gated secure storage',
                icon: { set: 'lucide', name: 'fingerprint' },
                route: 'authDemo',
            },
            {
                id: 'notifications',
                title: 'Notifications',
                description: 'Push registration (APNs/FCM) + local scheduling',
                icon: { set: 'lucide', name: 'bell' },
                route: 'notifications',
            },
            {
                id: 'background-tasks',
                title: 'Background tasks',
                description: 'BGTaskScheduler / WorkManager periodic work',
                icon: { set: 'lucide', name: 'timer' },
                route: 'backgroundTasks',
            },
            {
                id: 'storage',
                title: 'Storage',
                description: 'Persistent key/value round-trip + clear-all',
                icon: { set: 'lucide', name: 'database' },
                route: 'storageDemo',
            },
            {
                id: 'sqlite',
                title: 'SQLite',
                description: 'Chat-style message store: SQL, migrations, live queries',
                icon: { set: 'lucide', name: 'messages-square' },
                route: 'sqliteChatDemo',
            },
            {
                id: 'haptics',
                title: 'Haptics',
                description: 'Impact, notification and selection feedback',
                icon: { set: 'lucide', name: 'vibrate' },
                route: 'hapticsDemo',
            },
            {
                id: 'webrtc',
                title: 'WebRTC',
                description: 'Loopback echo call — mic, remote audio, data channel',
                icon: { set: 'lucide', name: 'phone-call' },
                route: 'webrtcDemo',
            },
        ],
    },
    {
        id: 'framework',
        title: 'Framework',
        icon: { set: 'lucide', name: 'package' },
        examples: [
            {
                id: 'dynamic-import',
                title: 'Dynamic import',
                description: 'Code-splitting via import() — async chunk loaded on demand, in dev and store builds',
                icon: { set: 'lucide', name: 'package-open' },
                route: 'dynamicImportDemo',
            },
        ],
    },
];

/** Example flattened with its parent area title (shown in search results). */
export type FlatExample = Example & { areaTitle: string };

export const allExamples: FlatExample[] = catalog.flatMap((area) =>
    area.examples.map((example) => ({ ...example, areaTitle: area.title })),
);

export function filterExamples(query: string): FlatExample[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allExamples.filter((e) =>
        e.title.toLowerCase().includes(q)
        || e.description.toLowerCase().includes(q)
        || e.areaTitle.toLowerCase().includes(q),
    );
}

export function getArea(id: string): Area | undefined {
    return catalog.find((a) => a.id === id);
}
