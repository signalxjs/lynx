/**
 * Device-log sentinel parser.
 *
 * The `@sigx/lynx-plugin` log-server middleware emits one line per device
 * log entry on the rspeedy child process's stdout, prefixed with a NUL
 * sentinel that the user terminal can never produce:
 *
 *   `\u0000SIGX_LOG\u0000{json}\n`
 *
 * `parseDeviceLogLine(raw)` strips the sentinel and returns the parsed
 * entry, or `null` if the line isn't a sentinel line (so the caller can
 * forward it to the terminal verbatim).
 *
 * `formatDeviceLogLine(entry)` renders a coloured, single-line
 * `📱 <platform> #<id>  HH:MM:SS  LEVEL  <msg>` string for the terminal.
 */

export const LOG_SENTINEL = '\u0000SIGX_LOG\u0000';

export interface DeviceLogEntry {
    level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';
    args: string[];
    ts: number;
    platform: string;
    client: number;
}

/**
 * Detect a sentinel line and JSON-parse the payload. Returns `null` for
 * any line that isn't a sentinel line or that fails to parse. We are
 * deliberately strict: an unparseable sentinel line is silently dropped
 * (the original lives on the rspeedy stdout we're already piping out),
 * because surfacing a JSON.parse failure to the user would be more
 * confusing than the missing log entry it represents.
 */
export function parseDeviceLogLine(line: string): DeviceLogEntry | null {
    if (!line.startsWith(LOG_SENTINEL)) return null;
    const payload = line.slice(LOG_SENTINEL.length);
    try {
        const parsed = JSON.parse(payload) as Partial<DeviceLogEntry>;
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.level !== 'string') return null;
        if (!Array.isArray(parsed.args)) return null;
        return {
            level: parsed.level as DeviceLogEntry['level'],
            args: parsed.args.map((a) => String(a)),
            ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now(),
            platform: typeof parsed.platform === 'string' ? parsed.platform : 'unknown',
            client: typeof parsed.client === 'number' ? parsed.client : 0,
        };
    } catch {
        return null;
    }
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const PLATFORM_COLOUR: Record<string, string> = {
    ios: '\x1b[36m',     // cyan
    android: '\x1b[32m', // green
    unknown: '\x1b[2m',  // dim
};
const LEVEL_COLOUR: Record<DeviceLogEntry['level'], string> = {
    log: '\x1b[0m',
    info: '\x1b[34m',  // blue
    debug: '\x1b[2m',  // dim
    trace: '\x1b[2m',
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
};
const LEVEL_LABEL: Record<DeviceLogEntry['level'], string> = {
    log: 'LOG  ',
    info: 'INFO ',
    debug: 'DBG  ',
    trace: 'TRC  ',
    warn: 'WARN ',
    error: 'ERR  ',
};

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatDeviceLogLine(entry: DeviceLogEntry): string {
    const platColour = PLATFORM_COLOUR[entry.platform] ?? PLATFORM_COLOUR['unknown']!;
    const levelColour = LEVEL_COLOUR[entry.level];
    const msg = entry.args.join(' ');
    // Multi-line messages: indent continuations so they line up under the message column.
    const indented = msg.replace(/\n/g, '\n           ');
    return (
        `  ${platColour}📱 ${entry.platform} #${entry.client}${RESET} ` +
        `${DIM}${formatTimestamp(entry.ts)}${RESET}  ` +
        `${levelColour}${LEVEL_LABEL[entry.level]}${RESET} ${indented}`
    );
}
