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

    modules: [
        '@sigx/lynx-storage',
        '@sigx/lynx-clipboard',
        '@sigx/lynx-haptics',
        '@sigx/lynx-device-info',
        '@sigx/lynx-network',
        '@sigx/lynx-websocket',
        '@sigx/lynx-safe-area',
        '@sigx/lynx-image-picker',
        '@sigx/lynx-location',
        '@sigx/lynx-share',
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
