/** @jsxImportSource @sigx/terminal */
/**
 * Renders the Logs-tab table through the real renderer and asserts it fits.
 *
 * The Devices tab shipped two off-by-one row bugs that a helper-level unit test
 * could not see, because the mistake was in what the caller *did* with the
 * numbers. Same discipline here: mount it, count the rows, sweep the heights.
 */
import { describe, it, expect } from 'vitest';
import {
    defineApp, terminalMount, setOutputTarget, Text, Col, Row, DataTable,
    type TableColumn,
} from '@sigx/terminal';
import { dataTableRows, dataTableWidth } from '../src/dev-ui/layout';
import {
    createDeviceLogStore, LEVEL_LABEL, LEVEL_TONE, type DeviceLogRecord,
} from '../src/dev-ui/device-log-store';
import type { DeviceLogEntry } from '../src/device-log';

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const cells = (s: string) => [...plain(s)].length;

function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }
function hhmmss(ts: number) {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const COLUMNS: TableColumn<DeviceLogRecord>[] = [
    { key: 'time', header: 'time', width: 8, value: (r) => hhmmss(r.ts) },
    { key: 'lvl', header: 'lvl', width: 3, value: (r) => LEVEL_LABEL[r.level], color: (r) => LEVEL_TONE[r.level] },
    { key: 'device', header: 'device', width: 12, min: 6, value: (r) => `${r.platform} #${r.client}` },
    { key: 'ns', header: 'ns', width: 10, min: 4, value: (r) => r.namespace ?? '—' },
    { key: 'msg', header: 'message', flex: true, min: 20, value: (r) => (r.lineCount > 1 ? `${r.head}  ⏎${r.lineCount}` : r.head) },
];

function seededStore(n = 12) {
    const s = createDeviceLogStore();
    const levels: DeviceLogEntry['level'][] = ['log', 'info', 'warn', 'error', 'debug'];
    for (let i = 0; i < n; i++) {
        s.push({
            level: levels[i % levels.length]!,
            args: i % 4 === 0
                ? ['[http]', `request ${i} completed with a fairly long message to push the flex column`]
                : [`plain message ${i}`],
            ts: 1_700_000_000_000 + i * 1000,
            platform: i % 2 ? 'android' : 'ios',
            client: (i % 3) + 1,
        });
    }
    return s;
}

function renderLogs(pane: { width: number; height: number }, rows: readonly DeviceLogRecord[]): string[] {
    const chunks: string[] = [];
    setOutputTarget({ write: (s: string) => { chunks.push(s); }, columns: pane.width, rows: pane.height, isTTY: false });

    // One row for the filter/summary line above the table, matching the tab.
    const tableHeight = Math.max(1, pane.height - 1);

    const App = () => (
        <Col>
            <Row gap={2}>
                <Text color="dim">{`${rows.length}/${rows.length}`}</Text>
                <Text color="faint">l level · /grep · /ns · /platform</Text>
            </Row>
            <DataTable
                columns={COLUMNS}
                rows={rows as DeviceLogRecord[]}
                identity={(r: DeviceLogRecord) => String(r.seq)}
                width={dataTableWidth(pane.width)}
                height={dataTableRows(tableHeight, { variant: 'plain', footer: false })}
                variant="plain"
                showFooter={false}
            />
        </Col>
    );

    const app = defineApp(<App />).mount({ mode: 'inline' }, terminalMount);
    app.unmount();
    return chunks.join('').split('\n');
}

describe('Logs tab table', () => {
    it('fits the width of an 80-column pane', () => {
        const pane = { width: 75, height: 14 };
        const lines = renderLogs(pane, seededStore().records());
        expect(Math.max(...lines.map(cells))).toBeLessThanOrEqual(pane.width);
    });

    it('fits the width of a 120-column pane', () => {
        const pane = { width: 115, height: 30 };
        const lines = renderLogs(pane, seededStore().records());
        expect(Math.max(...lines.map(cells))).toBeLessThanOrEqual(pane.width);
    });

    it('never emits more rows than the pane, swept across heights', () => {
        const rows = seededStore(40).records();
        for (let height = 6; height <= 34; height++) {
            const lines = renderLogs({ width: 115, height }, rows);
            const emitted = lines.filter((l, i) => l !== '' || i < lines.length - 1).length;
            expect(emitted, `pane height ${height} emitted ${emitted} rows`).toBeLessThanOrEqual(height);
        }
    });

    it('keeps the timestamp and level intact on a narrow pane, cutting the message', () => {
        // Only `msg` is flex, so layoutTable takes width from it rather than
        // from the fixed columns. Losing the clock to keep a message tail
        // would make the log unusable for correlating with anything.
        const text = plain(renderLogs({ width: 60, height: 20 }, seededStore().records()).join('\n'));
        expect(text).toMatch(/\d\d:\d\d:\d\d/);
        expect(text).toContain('ERR');
        expect(text).toContain('…');
    });

    it('marks a multi-line record rather than showing a silently cut first line', () => {
        const s = createDeviceLogStore();
        s.push({
            level: 'error',
            args: ['Error: boom\n  at one\n  at two'],
            ts: 1_700_000_000_000,
            platform: 'ios',
            client: 1,
        });
        const text = plain(renderLogs({ width: 115, height: 20 }, s.records()).join('\n'));
        expect(text).toContain('Error: boom');
        expect(text).toContain('⏎3');
    });

    it('shows the namespace column for core-logger records', () => {
        const text = plain(renderLogs({ width: 115, height: 20 }, seededStore().records()).join('\n'));
        expect(text).toContain('http');
        // Un-namespaced rows read as an em dash, not an empty cell.
        expect(text).toContain('—');
    });
});
