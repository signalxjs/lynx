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

    variants: {
        dev: { idSuffix: '.dev', nameSuffix: ' (Dev)' },
    },
});
