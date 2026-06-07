import type { RoutesWithoutParams } from '@sigx/lynx-navigation';
import type { IconSpec } from '@sigx/lynx-icons';
import { daisyDemos } from './daisyui/registry.js';

/**
 * The example catalog — single source of truth for the Home screen's area
 * list, the per-area sub views, and search. Every example points at a
 * registered route; `route: RoutesWithoutParams` makes a dangling
 * reference a type error (keyed by the Register augmentation in routes.ts)
 * and guarantees `nav.push(example.route)` needs no params — except the
 * DaisyUI component pages, which all share the parametric `daisyui` route
 * and carry their `componentId` in `params`.
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
                description: 'Image picker, voice-note recording, video playback',
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
                id: 'haptics',
                title: 'Haptics',
                description: 'Impact, notification and selection feedback',
                icon: { set: 'lucide', name: 'vibrate' },
                route: 'hapticsDemo',
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
