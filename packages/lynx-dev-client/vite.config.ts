import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: { index: 'src/index.ts', install: 'src/install.ts' },
    external: [/@sigx\/.*/, /@lynx-js\/.*/],
    platform: 'neutral',
});
