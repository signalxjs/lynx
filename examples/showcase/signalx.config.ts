import { defineLynxConfig } from '@sigx/lynx-cli/config';

export default defineLynxConfig({
    name: 'showcase',
    version: '0.1.0',
    buildNumber: '1',

    // App-shell assets — sigx ships sensible defaults in ./assets/.
    // Swap these PNGs to rebrand without touching native code.
    icon: 'assets/icon.png',
    splash: {
        image: 'assets/splash.png',
        backgroundColor: '#FFFFFF',
    },

    // Custom URL scheme for deep linking (showcase://...).
    // Comment out if you don't need deep links.
    scheme: 'showcase',

    // 'portrait' | 'landscape' | 'default'
    orientation: 'portrait',

    // Native modules auto-link from package.json — `@sigx/lynx-storage`,
    // `@sigx/lynx-haptics`, etc. are picked up via their `signalx-module.json`.
    // Add a `modules: [...]` entry here only to pass per-module `config`,
    // restrict `platforms`, or `disabled: true` an installed module.

    // @sigx/lynx-icons demo wiring. Each adapter is dynamically loaded by
    // @sigx/lynx-plugin at build time; only glyphs actually referenced in
    // <Icon set= name=> JSX (plus anything in `include`) end up in the bundle.
    iconSets: [
        // Set ids match Font Awesome's own prefix convention (`fas`, `far`,
        // `fab`) — same strings FA uses in its CSS classes and JS
        // `IconPrefix` type. The pinned components in
        // `@sigx/lynx-icons-fa-free/components` are hard-coded to these ids,
        // so renaming would break `<FaSolidIcon>` / `<FaBrandIcon>` calls.
        //
        // `include: ['*']` bundles the full FA-solid catalog so the
        // "Dynamic icon names" card on Settings can resolve names from a
        // JS array (the build-time scanner doesn't see them). Trade-off:
        // adds ~700 kB of glyph data to the bundle. Only opt in on sets
        // that genuinely need dynamic names.
        { id: 'fas', source: '@sigx/lynx-icons-fa-free', styles: ['solid'], include: ['*'] },
        { id: 'fab', source: '@sigx/lynx-icons-fa-free', styles: ['brands'] },
        // Lucide names used by the navigation surfaces and pinned
        // components. The build-time scanner only matches literal
        // `<Icon set= name=>` JSX — names passed via `IconSpec`
        // (`icon={{ set: 'lucide', name: 'map' }}`) or pinned components
        // (`<LucideIcon name="menu" />` from `@sigx/lynx-icons-lucide/components`)
        // need to be force-included here.
        {
            id: 'lucide',
            source: '@sigx/lynx-icons-lucide',
            include: ['map', 'compass', 'settings', 'chevron-left', 'menu', 'plus'],
        },
    ],

    android: {
        applicationId: 'com.example.showcase',
        versionCode: 1,
        minSdk: 24,
        targetSdk: 35,
        adaptiveIcon: {
            foreground: 'assets/adaptive-foreground.png',
            backgroundColor: '#0D9488',
        },
    },
    ios: {
        bundleIdentifier: 'com.example.showcase',
        deploymentTarget: '15.0',
    },
});
