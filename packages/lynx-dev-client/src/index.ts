/**
 * @sigx/lynx-dev-client
 *
 * Dev client for sigx-lynx apps. Native side (auto-linked during prebuild)
 * provides resource fetchers, template provider, and devtool integration.
 *
 * JS side exposes the console log streamer that ships device `console.*`
 * calls to the dev server. The streamer is auto-installed by
 * `@sigx/lynx-plugin` (dev only) via the `./install` entrypoint, so app
 * code does not need to import it manually.
 */

export const DEV_CLIENT_VERSION = '0.1.0';

export {
    installConsoleStreamer,
    serializeArg,
    type LogEntry,
    type LogLevel,
    type InstallOptions,
    type Uninstall,
} from './streamer';
