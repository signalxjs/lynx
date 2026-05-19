import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: { index: 'src/index.ts' },
    external: [/@sigx\/.*/, 'lucide', 'node:path', 'node:module', 'node:url'],
    platform: 'node',
});
