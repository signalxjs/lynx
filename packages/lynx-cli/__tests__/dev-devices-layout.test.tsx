/** @jsxImportSource @sigx/terminal */
/**
 * Renders the Devices-tab composition through the real renderer and asserts it
 * fits the pane it was given.
 *
 * `dev-ui-layout.test.ts` checks the arithmetic; this checks the arithmetic is
 * wired to the right props. The failure it exists to catch is specific and was
 * live until this PR: `DataTable` charges the cursor gutter against the
 * terminal width only when deriving its *default* width, so handing it
 * `pane.width` overflows by a column — invisible in a unit test of the helper,
 * and on screen it shears the shell's body box.
 *
 * The renderer's non-TTY path emits the finished frame as plain text on
 * unmount, which is what makes this assertable without a terminal.
 */
import { describe, it, expect } from 'vitest';
import {
    defineApp, terminalMount, setOutputTarget, Text, Col, Row, QRCode, DataTable, Spacer,
    type TableColumn,
} from '@sigx/terminal';
import { dataTableRows, dataTableWidth, placeQR } from '../src/dev-ui/layout';

const BUNDLE_URL = 'http://192.168.1.10:8788/main.lynx.bundle?v=1753872000000-12345';

interface Target { name: string; platform: string; form: string }

const TARGETS: Target[] = [
    { name: 'Pixel 8', platform: 'android', form: 'device' },
    { name: 'Pixel_7_API_34_extra_long_avd_name', platform: 'android', form: 'emulator' },
    { name: 'iPhone 15 Pro', platform: 'ios', form: 'simulator' },
];

const COLUMNS: TableColumn<Target>[] = [
    { key: 'name', header: 'Target', value: (r) => r.name, min: 10 },
    { key: 'platform', header: 'Platform', value: (r) => r.platform, width: 8 },
    { key: 'form', header: 'Kind', value: (r) => r.form, width: 9 },
];

// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const cells = (s: string) => [...plain(s)].length;

/** Mount the composition against a captured output target and return its lines. */
function renderPane(pane: { width: number; height: number }): string[] {
    const chunks: string[] = [];
    setOutputTarget({
        write: (s: string) => { chunks.push(s); },
        columns: pane.width,
        rows: pane.height,
        isTTY: false,
    });

    const placed = placeQR(BUNDLE_URL, pane);
    const tableRows = (h: number) => dataTableRows(h - 1, { variant: 'plain', footer: false });

    const table = (width: number, rows: number) => (
        <DataTable
            columns={COLUMNS}
            rows={TARGETS}
            identity={(r: Target) => r.name}
            width={dataTableWidth(width)}
            height={rows}
            variant="plain"
            showFooter={false}
        />
    );

    const App = () => (
        <Col>
            <box><Text color="dim">Local:  </Text><Text color="info" underline>{BUNDLE_URL}</Text></box>
            <Spacer size={1} />
            {placed.mode === 'beside' ? (
                <Row gap={4}>
                    <Col>
                        <Text color="dim">Scan with sigx-lynx-go:</Text>
                        <QRCode text={BUNDLE_URL} />
                    </Col>
                    <Col>
                        <Text color="fg" bold>Targets</Text>
                        {table(placed.tableWidth, tableRows(Math.min(pane.height - 2, placed.qr.rows)))}
                    </Col>
                </Row>
            ) : (
                <Col>
                    <Row gap={2}>
                        <Text color="fg" bold>Targets</Text>
                        <Text color="faint">z  show QR</Text>
                    </Row>
                    {table(pane.width, tableRows(pane.height - 2))}
                </Col>
            )}
        </Col>
    );

    const app = defineApp(<App />).mount({ mode: 'inline' }, terminalMount);
    app.unmount();
    return chunks.join('').split('\n');
}

describe('Devices tab composition', () => {
    it('fits the width of a wide pane, QR beside the table', () => {
        const pane = { width: 115, height: 30 };
        expect(placeQR(BUNDLE_URL, pane).mode).toBe('beside');

        const lines = renderPane(pane);
        const widest = Math.max(...lines.map(cells));
        expect(widest).toBeLessThanOrEqual(pane.width);
    });

    it('fits the width of an 80-column pane, where the QR cannot be shown', () => {
        const pane = { width: 75, height: 14 };
        expect(placeQR(BUNDLE_URL, pane).mode).toBe('hidden');

        const lines = renderPane(pane);
        const widest = Math.max(...lines.map(cells));
        expect(widest).toBeLessThanOrEqual(pane.width);
    });

    it('renders the target names rather than truncating the identity column', () => {
        // `layoutTable` shrinks from the right, so the identity column is the
        // last to be cut. A regression here shows up as an ellipsised device
        // name — the one cell you identify a row by.
        const text = plain(renderPane({ width: 115, height: 30 }).join('\n'));
        expect(text).toContain('Pixel 8');
        expect(text).toContain('iPhone 15 Pro');
        expect(text).not.toContain('Pixel…');
    });

    it('offers the QR zoom hint exactly when the QR is hidden', () => {
        expect(plain(renderPane({ width: 75, height: 14 }).join('\n'))).toContain('z  show QR');
        expect(plain(renderPane({ width: 115, height: 30 }).join('\n'))).not.toContain('z  show QR');
    });
});
