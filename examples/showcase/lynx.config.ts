import { defineConfig } from '@lynx-js/rspeedy';
import { pluginSigxLynx } from '@sigx/lynx-plugin';

export default defineConfig({
    source: {
        entry: {
            main: './src/main.tsx',
        },
    },
    // Build both the native Lynx template (`main.lynx.bundle`) and the
    // un-encoded web template (`main.web.bundle`) that upstream
    // `@lynx-js/web-core`'s `<lynx-view>` loads in the browser. The
    // `pluginSigxLynx` plugin reacts to `environment.name`, so the `web`
    // entry automatically flows through its `isWeb` build branches.
    //
    // NOTE: declaring `environments` is OPTIONAL for `sigx run:web` since #699
    // — the plugin auto-provides `lynx` + `web` when the CLI requests a web
    // build. The showcase keeps the explicit block so a plain `pnpm build`
    // (no CLI involved) still produces BOTH bundles.
    environments: {
        lynx: {},
        web: {},
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
