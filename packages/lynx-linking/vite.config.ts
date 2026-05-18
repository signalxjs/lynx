import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: {
        index: 'src/index.ts',
        router: 'src/router.ts',
    },
    external: [/@sigx\/.*/, /@lynx-js\/.*/],
    platform: 'neutral',
});
