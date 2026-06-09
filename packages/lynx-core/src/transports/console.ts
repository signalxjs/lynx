/**
 * Default {@link LogTransport} — routes records to `console.*` by level.
 *
 * In development `@sigx/lynx-dev-client` patches `console.*` and streams the
 * output to the `sigx dev` terminal, so console records show up there with no
 * extra channel. Installed as the default transport by the package barrel.
 */
import type { LogRecord, LogTransport } from '../logger.js';

export const consoleTransport: LogTransport = (record: LogRecord): void => {
    const args = [`[${record.namespace}]`, record.msg, ...record.fields];
    switch (record.level.name) {
        case 'error':
            console.error(...args);
            break;
        case 'warn':
            console.warn(...args);
            break;
        default:
            // trace/debug/info → console.log (the dev-client streamer forwards all levels)
            console.log(...args);
    }
};
