import { defineLynxConfig } from '@sigx/lynx-cli/config';

export default defineLynxConfig({
    name: 'FLIK',
    version: '0.1.0',
    buildNumber: '1',

    icon: 'assets/icon.png',
    splash: {
        image: 'assets/splash.png',
        backgroundColor: '#0B1020',
    },

    // Portrait only. The board's zone bands are fractions of height and the
    // whole game reads as a vertical corridor — a landscape relayout would
    // make the target zones wider than they are deep, which changes the game
    // rather than just the presentation.
    orientation: 'portrait',

    android: {
        applicationId: 'com.example.flik',
        versionCode: 1,
        minSdk: 24,
        targetSdk: 35,
        adaptiveIcon: {
            foreground: 'assets/adaptive-foreground.png',
            backgroundColor: '#0B1020',
        },
    },
    ios: {
        bundleIdentifier: 'com.example.flik',
        deploymentTarget: '15.0',
        usesNonExemptEncryption: false,
    },

    // App env (#1244) — typed build-time settings baked into the bundle and
    // read via `import { env } from '@sigx/lynx'` (typed in src/sigx-env.d.ts).
    // `perfTools` shows the render-mode switch + stress panel; turn it off
    // for a store-bound build.
    env: {
        perfTools: true,
    },

    variants: {
        dev: { idSuffix: '.dev', nameSuffix: ' (Dev)', env: { perfTools: true } },
    },
});
