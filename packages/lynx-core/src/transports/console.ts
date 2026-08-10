/**
 * Default {@link LogTransport} — routes records to `console.*` by level.
 *
 * In development `@sigx/lynx-dev-client` patches `console.*` and streams the
 * output to the `sigx dev` terminal, so console records show up there with no
 * extra channel. Installed as the default transport by the package barrel.
 *
 * **Exempt from C10's "no bare `console.*`" rule, because this is the logger's
 * own sink.** Routing it through a logger would make every record re-enter
 * `emit` and recurse until the stack blows. The exemption covers this file's
 * three calls; the barrel that installs the transport still uses
 * `createLogger`.
 *
 * It is not the repo's only C10 exemption — `@sigx/lynx-dev-client`'s streamer
 * must call the *captured* console originals (patching them is its job), and
 * main-thread worklet code cannot reach `createLogger` at all. Each of those
 * is documented where it lives.
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
