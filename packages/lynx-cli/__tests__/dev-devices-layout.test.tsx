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
import { planDevices } from '../src/dev-ui/layout';

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

    // One URL line, matching the single `Local:` row below. Drives the SAME
    // planner the tab does — the arithmetic used to be restated here, which is
    // how a missing row went unnoticed in both.
    const plan = planDevices(BUNDLE_URL, pane, 1);
    const placed = plan.placement;

    const table = () => (
        <DataTable
            columns={COLUMNS}
            rows={TARGETS}
            identity={(r: Target) => r.name}
            width={plan.tableWidth}
            height={plan.tableRows}
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
                        <QRCode text={BUNDLE_URL} quiet={placed.qr.quiet} />
                    </Col>
                    <Col>
                        <Text color="fg" bold>Targets</Text>
                        {table()}
                    </Col>
                </Row>
            ) : (
                <Col>
                    <Row gap={2}>
                        <Text color="fg" bold>Targets</Text>
                        <Text color="faint">z  show QR</Text>
                    </Row>
                    {table()}
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
        expect(planDevices(BUNDLE_URL, pane, 1).placement.mode).toBe('beside');

        const lines = renderPane(pane);
        const widest = Math.max(...lines.map(cells));
        expect(widest).toBeLessThanOrEqual(pane.width);
    });

    it('fits the width of an 80-column pane, where the QR cannot be shown', () => {
        const pane = { width: 75, height: 14 };
        expect(planDevices(BUNDLE_URL, pane, 1).placement.mode).toBe('hidden');

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

    it('never emits more rows than the pane, at every height around the QR boundary', () => {
        // The regression this exists for: the QR column is the code *plus* its
        // label, and the earlier code compared only `qr.rows` to the budget.
        // That fits at 14 and 30 rows and overflows by one at 20 and 23 — so a
        // couple of sampled sizes miss it entirely and the shell's status line
        // silently drops off the bottom. Sweep the boundary instead.
        for (let height = 12; height <= 34; height++) {
            const lines = renderPane({ width: 115, height });
            // The renderer emits a trailing newline; the frame is the content.
            const emitted = lines.filter((l, i) => l !== '' || i < lines.length - 1).length;
            expect(
                emitted,
                `pane height ${height} emitted ${emitted} rows`,
            ).toBeLessThanOrEqual(height);
        }
    });

    it('offers the QR zoom hint exactly when the QR is hidden', () => {
        expect(plain(renderPane({ width: 75, height: 14 }).join('\n'))).toContain('z  show QR');
        expect(plain(renderPane({ width: 115, height: 30 }).join('\n'))).not.toContain('z  show QR');
    });
});
