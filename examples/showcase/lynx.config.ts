import { defineConfig } from '@lynx-js/rspeedy';
import { pluginSigxLynx } from '@sigx/lynx-plugin';

export default defineConfig({
    source: {
        entry: {
            main: './src/main.tsx',
        },
    },
    server: {
        host: '0.0.0.0',
        port: 8788,
    },
    plugins: [
        pluginSigxLynx({
            enableCSSInheritance: true,
        }),
    ],
});
