import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: {
        'index': 'src/index.ts',
        'mt/index': 'src/mt/index.ts',
        'mt/setup': 'src/mt/setup.ts'
    },
    // Externalise @sigx/* + @lynx-js/* + vitest — `@sigx/lynx-testing/mt`
    // pulls these in as peer dependencies and we don't want to bundle
    // them into lynx-testing's dist.
    external: [/@sigx\/.*/, /@lynx-js\/.*/, 'vitest']
});
