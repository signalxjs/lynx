import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: {
        index: 'src/index.ts',
        // Discovered by `@sigx/cli` via the `"sigx-cli": { "plugin": ... }`
        // field in this package's package.json; needs its own dist file.
        plugin: 'src/plugin.ts',
        'config/index': 'src/config/index.ts',
    },
    external: [
        /@sigx\/.*/,
        /@lynx-js\/.*/,
        /@rspack\/.*/,
        'esbuild',
        'sharp',
        /^node:/,
    ],
    platform: 'node',
});
