import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: {
        index: 'src/index.ts',
        // Direct subpath entry for the plugin to inject as the MT bootstrap.
        // Importing this file directly (rather than the barrel) guarantees
        // the top-level globalThis.processData / renderPage / sigxPatchUpdate
        // assignments execute, no matter what tree-shaking the consumer does.
        'entry-main': 'src/entry-main.ts',
        // Installs the hybrid worklet into lynxWorkletImpl._workletMap. Must
        // run AFTER @lynx-js/react/worklet-runtime — the bootstrap preamble
        // in worklet-loader-mt.ts orders it accordingly.
        'install-hybrid-worklet': 'src/install-hybrid-worklet.ts',
    },
    external: [/@sigx\/.*/, /@lynx-js\/.*/],
    platform: 'neutral'
});
