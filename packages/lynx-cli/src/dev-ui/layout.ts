/**
 * Pane arithmetic for the `sigx dev` dashboard — the only place in this
 * package that counts terminal rows and columns.
 *
 * `ShellTab.render(pane)` (`@sigx/cli` >= 0.9) hands each tab the area left
 * after the shell drew its own chrome: title bar, tab strip, spacers, status
 * line, and the body box. Before that existed this file's job was done by a
 * literal — `Math.max(8, getTerminalSize().rows - 13)` — with a comment
 * re-counting the shell's chrome by hand. That number was wrong the moment the
 * shell changed shape, and nothing failed loudly when it did.
 *
 * So: nothing here restates a component's geometry. Every figure is derived
 * from `boxChrome`, which mirrors the renderer's `drawBox`, so a change to the
 * box primitive moves these numbers instead of silently invalidating them.
 *
 * The pane is a **budget, not a reservation**. The renderer's layout is
 * content-driven and there is no clipping primitive, so a body that emits more
 * rows than it was given pushes the shell's own footer off the bottom rather
 * than being cut off. Fit content to the budget; don't assume it is enforced.
 */
import { boxChrome, generateQR, displayWidth } from '@sigx/terminal';

/**
 * Label printed above the pairing QR.
 *
 * Lives here rather than in `dev-shell.tsx` so the plain `--no-ui` banner can
 * share it without importing the dashboard — and with it `runShell` — on a
 * path that deliberately never mounts one.
 */
export const QR_SCAN_LABEL = 'Scan with sigx-lynx-go:';

/** Smallest device/log table worth putting beside a QR code. */
export const MIN_TABLE_COLS = 28;

/**
 * Below this many rows the table+detail split leaves the table unusable, so
 * the detail pane takes the whole pane instead of sharing it.
 */
export const MIN_SPLIT_ROWS = 20;

/**
 * `LogView` draws a rounded, x-padded viewport box and a `1–40/40 · following`
 * footer under it. Its own outer `<box>` is borderless and therefore free.
 */
const LOGVIEW_BOX = { border: 'rounded', padX: 1 } as const;
const LOGVIEW_FOOTER_ROWS = 1;
export const LOGVIEW_CHROME_ROWS = boxChrome(LOGVIEW_BOX).rows + LOGVIEW_FOOTER_ROWS;

/**
 * Rows to give `LogView`'s `height` so the component as a whole occupies `h`.
 *
 * Note the asymmetry with {@link dataTableWidth}: `LogView` takes its *outer*
 * width and subtracts its own box internally, so its `width` prop can be the
 * pane width verbatim. Only the height needs adjusting.
 */
export function logViewHeight(h: number): number {
    return Math.max(3, Math.floor(h) - LOGVIEW_CHROME_ROWS);
}

export interface TableChromeOptions {
    variant?: 'plain' | 'ruled' | 'boxed';
    /** `showFooter`. Default true, matching the component. */
    footer?: boolean;
}

function tableBox(variant: TableChromeOptions['variant']) {
    const boxed = variant === 'boxed';
    return { border: boxed, padX: boxed ? 1 : 0 };
}

/**
 * Rows to give `DataTable`'s `height` so the component as a whole occupies `h`.
 *
 * A table spends: one header row, one rule (every variant but `plain`), the
 * body, one footer (unless `showFooter={false}`), and its own box when boxed.
 */
export function dataTableRows(h: number, o: TableChromeOptions = {}): number {
    const chrome = 1
        + (o.variant === 'plain' ? 0 : 1)
        + (o.footer === false ? 0 : 1)
        + boxChrome(tableBox(o.variant)).rows;
    return Math.max(1, Math.floor(h) - chrome);
}

/**
 * Width to give `DataTable`'s `width` so the component as a whole occupies `w`.
 *
 * **This is not `pane.width`, and the difference is easy to miss.** `DataTable`
 * charges the cursor gutter and its own box against the terminal width only
 * when it is computing its *default* width; an explicit `width` prop is passed
 * straight to `layoutTable`, and the one-cell cursor gutter is still prefixed
 * to every row afterwards. Handing it the raw pane therefore overflows by
 * exactly one column — plus the box, when boxed.
 */
export function dataTableWidth(w: number, o: TableChromeOptions = {}): number {
    const CURSOR_GUTTER_COLS = 1;
    return Math.max(12, Math.floor(w) - CURSOR_GUTTER_COLS - boxChrome(tableBox(o.variant)).cols);
}

export interface QRSize {
    lines: string[];
    rows: number;
    cols: number;
    /**
     * The quiet zone this was measured at — pass it straight to `<QRCode>`,
     * or the component renders the default and silently undoes the fit.
     */
    quiet: number | undefined;
}

/**
 * Rows the tightest usable code for `url` needs — what to tell a user whose
 * window is too small.
 */
export function minQRRows(url: string): number {
    return measureQR(url, 1).rows;
}

const qrCache = new Map<string, QRSize>();

/**
 * Render and measure a QR code.
 *
 * Measured, never assumed: the size depends on how much data the URL carries.
 * A dev bundle URL — `http://192.168.1.10:8788/main.lynx.bundle?v=<buildId>`,
 * about 63 characters — lands on QR version 4, which is **21 rows by 41
 * columns** at the default quiet zone (19x37 at `quiet: 2`, 18x35 at 1). A tab
 * pane on an 80x24 terminal is roughly 14 rows, so the QR does not fit there
 * at any quiet zone and the caller has to fall back rather than overflow.
 *
 * Memoised because the encoder is not free and the URL changes once per run.
 */
export function measureQR(text: string, quiet?: number): QRSize {
    const key = `${quiet ?? -1}|${text}`;
    const hit = qrCache.get(key);
    if (hit) return hit;

    const lines = generateQR(text, quiet === undefined ? undefined : { quiet }).split('\n');
    const size: QRSize = {
        lines,
        quiet,
        rows: lines.length,
        // Display cells, not code units — the half-block glyphs are single
        // width today, but measuring by `.length` is the bug that bites the
        // moment anything wide appears in a line.
        cols: lines.reduce((max, line) => Math.max(max, displayWidth(line)), 0),
    };
    qrCache.set(key, size);
    return size;
}

/** How the Devices tab should place the QR in the pane it was given. */
export type QRPlacement =
    | { mode: 'beside'; qr: QRSize; tableWidth: number }
    | { mode: 'hidden' };

/**
 * Rows the Devices tab spends around the QR, charged before asking whether the
 * code itself fits. Getting these wrong is an off-by-one that only appears at
 * boundary heights — the frame looks right at 24 and 40 rows and drops the
 * shell's footer at 30.
 */
/** `beside`: the "Scan with…" label above the code. */
export const QR_BESIDE_CHROME_ROWS = 1;
/** `zoom`: the label above, plus the URL and the `esc back` hint below. */
export const QR_ZOOM_CHROME_ROWS = 3;

/** Everything the Devices tab needs to lay itself out in `pane`. */
export interface DevicesPlan {
    /** Rows left under the URL list and its trailing blank line. */
    below: { width: number; height: number };
    placement: QRPlacement;
    /** `height` for the target `DataTable`. */
    tableRows: number;
    /** `width` to hand the target `DataTable` — already gutter-corrected. */
    tableWidth: number;
}

/**
 * Plan the Devices tab in one place.
 *
 * This exists because the arithmetic was previously duplicated between the tab
 * and its test, which is exactly how the label row came to be charged in
 * neither: the test agreed with the bug. One function, both callers.
 */
export function planDevices(
    url: string,
    pane: { width: number; height: number },
    urlRows: number,
    /**
     * Rows the caller spends *below* the table — the activity notice and the
     * build tail. Charged here rather than by the caller, because the last two
     * times a row was spent outside this function it overflowed the pane at
     * boundary heights and pushed the shell's status line off the screen.
     */
    footerRows = 0,
): DevicesPlan {
    const below = {
        width: pane.width,
        height: Math.max(
            1,
            pane.height
            - urlRows
            - 1 /* blank line under the URLs */
            - footerRows,
        ),
    };
    // The footer is charged into `below` above, so the QR placement sees the
    // real budget. Charging it only against the table would let the QR column
    // — which is taller than the table and therefore sets the row height —
    // push the whole thing past the pane.
    const placement = placeQR(url, {
        width: below.width,
        height: below.height - QR_BESIDE_CHROME_ROWS,
    });
    // One row for the "Devices" heading above the table in both arrangements.
    const HEADING_ROWS = 1;
    const availableRows = placement.mode === 'beside'
        ? Math.min(below.height, placement.qr.rows + QR_BESIDE_CHROME_ROWS)
        : below.height;
    return {
        below,
        placement,
        tableRows: dataTableRows(availableRows - HEADING_ROWS, { variant: 'plain', footer: false }),
        tableWidth: dataTableWidth(placement.mode === 'beside' ? placement.tableWidth : below.width),
    };
}

/**
 * Whether a full-pane QR fits, and at which quiet zone — for the `z` zoom.
 *
 * The zoom is offered precisely when {@link placeQR} said no, so it cannot
 * assume the code fits just because it now has the whole pane: on an 80x24
 * terminal the pane is ~14 rows and the smallest usable code is 18, so there
 * is no arrangement that works. Drawing it anyway does real damage — the pane
 * is a budget, not a reservation, so the overflow pushes the shell's own
 * status line and hints off the bottom of the screen.
 *
 * Returns the fitting `QRSize`, or `null` when the caller must show the URL
 * and ask for a bigger window instead.
 */
export function fitQRToPane(url: string, pane: { width: number; height: number }): QRSize | null {
    for (const quiet of [undefined, 1]) {
        const qr = measureQR(url, quiet);
        if (qr.rows <= pane.height && qr.cols <= pane.width) return qr;
    }
    return null;
}

/**
 * Decide whether the QR fits beside the device table.
 *
 * Tries the default quiet zone first and then a tightened one, because losing
 * two rows of margin is a much better trade than losing the QR. When even that
 * does not fit, the caller shows the table full width and offers the zoom
 * overlay instead — the QR is never drawn clipped, which would make it
 * unscannable while looking fine.
 */
export function placeQR(url: string, pane: { width: number; height: number }, gap = 4): QRPlacement {
    for (const quiet of [undefined, 1]) {
        const qr = measureQR(url, quiet);
        if (qr.rows <= pane.height && qr.cols + gap + MIN_TABLE_COLS <= pane.width) {
            return { mode: 'beside', qr, tableWidth: pane.width - qr.cols - gap };
        }
    }
    return { mode: 'hidden' };
}
