import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: 'src/index.ts',
    external: [/@sigx\/.*/],
    platform: 'neutral'
});
