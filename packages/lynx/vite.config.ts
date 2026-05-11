import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: {
        'index': 'src/index.ts',
        'jsx-runtime': 'src/jsx-runtime.ts',
        'jsx-dev-runtime': 'src/jsx-dev-runtime.ts'
    },
    external: [/@sigx\/.*/, /@lynx-js\/.*/],
    platform: 'neutral'
});
