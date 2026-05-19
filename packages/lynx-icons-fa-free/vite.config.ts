import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: { index: 'src/index.ts' },
    external: [/@sigx\/.*/, /@fortawesome\/.*/, 'node:path', 'node:module', 'node:url'],
    platform: 'node',
});
