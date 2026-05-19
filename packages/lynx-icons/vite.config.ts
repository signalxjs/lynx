import { defineConfig, mergeConfig } from 'vite';
import { defineLibConfig } from '@sigx/vite/lib';

export default mergeConfig(
    defineLibConfig({
        entry: {
            'index': 'src/index.ts',
            'defineIconSet': 'src/defineIconSet.ts',
            'stubs/codepoints': 'src/stubs/codepoints.ts',
            'stubs/svgs': 'src/stubs/svgs.ts',
        },
        external: [/@sigx\/.*/, /@lynx-js\/.*/],
        platform: 'neutral',
    }),
    defineConfig({
        oxc: {
            jsx: { runtime: 'automatic', importSource: '@sigx/lynx' },
        },
    }),
);
