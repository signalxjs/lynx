import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: {
        'index': 'src/index.ts',
        'hmr': 'src/hmr.ts',
        'mt-hmr-bridge': 'src/mt-hmr-bridge.ts'
    },
    external: [/@sigx\/.*/, /@lynx-js\/.*/, /@rspack\/.*/],
    platform: 'neutral'
});
