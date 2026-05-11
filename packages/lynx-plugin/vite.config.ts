import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: {
        'index': 'src/index.ts',
        'loaders/ignore-css-loader': 'src/loaders/ignore-css-loader.ts',
        'loaders/hmr-loader': 'src/loaders/hmr-loader.ts',
        'loaders/worklet-loader': 'src/loaders/worklet-loader.ts',
        'loaders/worklet-loader-mt': 'src/loaders/worklet-loader-mt.ts'
    },
    external: [/@sigx\/.*/, /@lynx-js\/.*/, /@rspack\/.*/, 'rspack', 'webpack', 'path', 'fs', 'url', /^node:/],
    platform: 'node'
});
