import { defineConfig } from '@lynx-js/rspeedy';
import { pluginSigxLynx } from '@sigx/lynx-plugin';

export default defineConfig({
    source: {
        entry: {
            main: './src/main.tsx',
        },
    },
    // Both the native Lynx template and the web one, so a plain `pnpm build`
    // (no CLI involved) produces both — same reasoning as the showcase.
    environments: {
        lynx: {},
        web: {},
    },
    server: {
        host: '0.0.0.0',
        // NOT the showcase's 8788: the two dev servers must be able to run at
        // once. The CLI reclaims a busy port rather than failing, so a clash
        // wouldn't error — it would quietly serve the other checkout's bundle.
        // The log websocket takes `port + 1`, so leave a gap before the next app.
        port: 8789,
    },
    plugins: [
        pluginSigxLynx({
            enableCSSInheritance: true,
        }),
    ],
});
