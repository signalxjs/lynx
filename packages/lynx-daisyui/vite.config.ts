import { defineConfig, mergeConfig } from 'vite';
import { defineLibConfig } from '@sigx/vite/lib';

// lynx-daisyui authored in TSX — enable JSX parsing with Lynx's import source.
// (defineLibConfig's `jsx: true` hardcodes 'sigx'; for Lynx we override below.)
export default mergeConfig(
    defineLibConfig({
        entry: {
            'index': 'src/index.ts',
            'preset/index': 'src/preset/index.ts'
        },
        external: [/@sigx\/.*/, 'tailwindcss', /^tailwindcss\/.*/],
        platform: 'neutral'
    }),
    defineConfig({
        oxc: {
            jsx: { runtime: 'automatic', importSource: '@sigx/lynx' }
        }
    })
);
