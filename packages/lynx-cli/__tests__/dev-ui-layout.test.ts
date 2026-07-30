/**
 * Tests for the dev dashboard's pane arithmetic.
 *
 * These assert *measurements*, not appearance: the point of `dev-ui/layout.ts`
 * is that a component given `dataTableRows(h)` occupies exactly `h` rows, so a
 * change to the underlying box geometry has to fail here rather than quietly
 * push the shell's footer off the bottom of the terminal.
 */
import { describe, it, expect } from 'vitest';
import { boxChrome } from '@sigx/terminal';
import {
    dataTableRows,
    dataTableWidth,
    logViewHeight,
    LOGVIEW_CHROME_ROWS,
    measureQR,
    placeQR,
    MIN_TABLE_COLS,
} from '../src/dev-ui/layout';

/** A realistic dev bundle URL — the thing actually encoded in the dashboard. */
const BUNDLE_URL = 'http://192.168.1.10:8788/main.lynx.bundle?v=1753872000000-12345';

/** The pane an 80x24 terminal leaves a tab, per runShell's fullscreen layout. */
const PANE_80x24 = { width: 75, height: 14 };
const PANE_120x40 = { width: 115, height: 30 };

describe('logViewHeight', () => {
    it('accounts for the viewport box and the follow footer', () => {
        // rounded border (2 rows) + the `1-40/40 · following` footer (1).
        expect(LOGVIEW_CHROME_ROWS).toBe(3);
        expect(logViewHeight(14)).toBe(11);
        expect(logViewHeight(30)).toBe(27);
    });

    it('never returns a viewport too small to show context', () => {
        expect(logViewHeight(0)).toBe(3);
        expect(logViewHeight(-10)).toBe(3);
    });
});

describe('dataTableRows', () => {
    it('charges header, rule and footer for the default ruled variant', () => {
        // header + rule + footer = 3
        expect(dataTableRows(14)).toBe(11);
    });

    it('drops the rule for the plain variant', () => {
        expect(dataTableRows(14, { variant: 'plain' })).toBe(12);
    });

    it('drops the footer when it is not drawn', () => {
        expect(dataTableRows(14, { variant: 'plain', footer: false })).toBe(13);
    });

    it('charges the box for the boxed variant', () => {
        const box = boxChrome({ border: true, padX: 1 });
        expect(dataTableRows(14, { variant: 'boxed' })).toBe(14 - 3 - box.rows);
    });

    it('always leaves at least one body row', () => {
        expect(dataTableRows(1)).toBe(1);
        expect(dataTableRows(-5)).toBe(1);
    });
});

describe('dataTableWidth', () => {
    it('reserves the cursor gutter that DataTable prefixes to every row', () => {
        // The component only subtracts this when deriving its DEFAULT width;
        // an explicit `width` is passed straight through to layoutTable.
        expect(dataTableWidth(75)).toBe(74);
    });

    it('reserves the box as well when boxed', () => {
        const box = boxChrome({ border: true, padX: 1 });
        expect(dataTableWidth(75, { variant: 'boxed' })).toBe(75 - 1 - box.cols);
    });
});

describe('measureQR', () => {
    it('measures a real bundle URL at 21x41 — taller than an 80x24 pane', () => {
        const qr = measureQR(BUNDLE_URL);
        expect(qr.rows).toBe(21);
        expect(qr.cols).toBe(41);
        // The regression this guards: assuming the QR fits the pane.
        expect(qr.rows).toBeGreaterThan(PANE_80x24.height);
    });

    it('shrinks with a tighter quiet zone, but not enough to fit 80x24', () => {
        expect(measureQR(BUNDLE_URL, 1).rows).toBe(18);
        expect(measureQR(BUNDLE_URL, 1).rows).toBeGreaterThan(PANE_80x24.height);
    });

    it('returns one line per row', () => {
        const qr = measureQR(BUNDLE_URL);
        expect(qr.lines).toHaveLength(qr.rows);
    });

    it('memoises per (text, quiet)', () => {
        expect(measureQR(BUNDLE_URL)).toBe(measureQR(BUNDLE_URL));
        expect(measureQR(BUNDLE_URL, 1)).not.toBe(measureQR(BUNDLE_URL));
    });
});

describe('placeQR', () => {
    it('hides the QR when the pane is too short for it', () => {
        expect(placeQR(BUNDLE_URL, PANE_80x24)).toEqual({ mode: 'hidden' });
    });

    it('places it beside the table when the pane can afford both', () => {
        const placed = placeQR(BUNDLE_URL, PANE_120x40);
        expect(placed.mode).toBe('beside');
        if (placed.mode !== 'beside') return;
        expect(placed.qr.rows).toBeLessThanOrEqual(PANE_120x40.height);
        expect(placed.tableWidth).toBeGreaterThanOrEqual(MIN_TABLE_COLS);
        // QR + gap + table must not exceed the pane.
        expect(placed.qr.cols + 4 + placed.tableWidth).toBe(PANE_120x40.width);
    });

    it('hides it rather than squeezing the table below a usable width', () => {
        // Tall enough for the QR, but too narrow to keep a table beside it.
        expect(placeQR(BUNDLE_URL, { width: 50, height: 30 })).toEqual({ mode: 'hidden' });
    });
});
