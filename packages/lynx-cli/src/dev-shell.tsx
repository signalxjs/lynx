/** @jsxImportSource @sigx/terminal */
/**
 * The `sigx dev` dashboard — a ShellConfig for @sigx/cli/shell's runShell.
 *
 * Tabs: Devices (QR + URLs + the target table) and Logs (LogView over the
 * shell's streaming store). Shortcuts r/d/a/i mirror the legacy raw-stdin
 * keys; /reload etc. mirror them as slash commands.
 *
 * The dev server starts AFTER the shell mounts, so server-dependent pieces
 * late-bind: `state` (signal-backed) is filled in when rspeedy reports ready,
 * and `actions`/`shutdown` are bound by startDevServer once the child exists.
 *
 * ── Reserved keys — read before adding a shortcut ────────────────────────
 * Key dispatch runs `overlay` → `control` → `view` → `global`, and the first
 * handler returning `true` consumes. `runShell` registers every entry of
 * `shortcuts` below on the `overlay` layer, while `DataTable` and `LogView`
 * register on `control` (onKey's default). So a shell shortcut ALWAYS wins:
 * a single letter added here becomes permanently unreachable inside any
 * focused component, silently.
 *
 * Consequences, deliberate:
 *   - `f`, `j`, `k` belong to LogView/DataTable. Never add them here.
 *   - `DataTable`'s own `r` (reverse sort) is unreachable, because `r` is
 *     reload — which is the right trade, `r` being the dev-loop key everyone
 *     already knows. No table in this dashboard sets `sortable`; sorting is
 *     driven by ←/→ and owned by the tab instead.
 *   - Tab-scoped keys (`z` here) are gated on `handle.activeTab` rather than
 *     registered per tab, so they cannot leak into a tab that has no meaning
 *     for them.
 */
import { runShell, type ShellConfig } from '@sigx/cli/shell';
import type { ShellHandle, ShellPane, SigxPlugin, StatusItem } from '@sigx/cli/plugin';
import {
    signal, Text, Col, Row, QRCode, LogView, DataTable, Spacer,
    onKey, isEsc, type TableColumn,
} from '@sigx/terminal';
import type { SelectedTarget } from './target-picker.js';
import type { DevActions } from './dev-server.js';
import {
    logViewHeight, planDevices, fitQRToPane, minQRRows,
    QR_SCAN_LABEL, QR_ZOOM_CHROME_ROWS,
} from './dev-ui/layout.js';

export interface DevShellState {
    ready: boolean;
    /** Label of an in-flight gradle/xcodebuild run, or null. */
    building: string | null;
    port: number;
    buildId: string;
    urls: { label: string; url: string }[];
    primaryUrl: string;
    targets: SelectedTarget[];
}

export interface DevShellController {
    handle: ShellHandle;
    state: DevShellState;
    /** Called by startDevServer once the rspeedy child exists. */
    bind: (b: { actions: DevActions; shutdown: (code?: number) => void; childClosed: Promise<void> }) => void;
}

function targetLabel(t: SelectedTarget): string {
    switch (t.kind) {
        case 'android-device': return t.model || t.deviceId;
        case 'android-avd': return t.avdName;
        case 'ios-simulator': return t.name;
        case 'ios-device': return t.name;
    }
}

/**
 * Stable, unique key for a target row.
 *
 * Not {@link targetLabel}: labels collide in ordinary setups — two Pixel 8s on
 * the same desk both report `model: 'Pixel 8'`, and a simulator and a physical
 * device can share a name. `DataTable` uses `identity` to break sort ties and
 * to keep the cursor on the same row across re-renders, so a collision makes
 * the selection jump between devices. The underlying ids are unique already;
 * the `kind` prefix keeps two namespaces from ever meeting.
 */
export function targetIdentity(t: SelectedTarget): string {
    switch (t.kind) {
        case 'android-device': return `android-device:${t.deviceId}`;
        case 'android-avd': return `android-avd:${t.avdName}`;
        case 'ios-simulator': return `ios-simulator:${t.udid}`;
        case 'ios-device': return `ios-device:${t.udid}`;
    }
}

function targetPlatform(t: SelectedTarget): string {
    return t.kind.startsWith('android') ? 'android' : 'ios';
}

function targetForm(t: SelectedTarget): string {
    switch (t.kind) {
        case 'android-device': return 'device';
        case 'android-avd': return 'emulator';
        case 'ios-simulator': return 'simulator';
        case 'ios-device': return 'device';
    }
}

const TARGET_COLUMNS: TableColumn<SelectedTarget>[] = [
    // Identity first, and deliberately NOT `flex`. `layoutTable` already
    // shrinks from the right, so the device name — the cell you identify a
    // row by — is the last thing to be truncated. `flex` is the opposite
    // knob: it absorbs *surplus* width, which on a wide pane stretches this
    // column by ~50 blank columns and shoves the rest to the far edge. Let
    // the table hug its content instead.
    { key: 'name', header: 'Target', value: targetLabel, min: 10 },
    { key: 'platform', header: 'Platform', value: targetPlatform, width: 8 },
    { key: 'form', header: 'Kind', value: targetForm, width: 9 },
];

export async function createDevShell(opts: {
    projectName: string;
    version?: string;
    targets: SelectedTarget[];
    plugins?: SigxPlugin[];
    hasAndroidApp: boolean;
    hasIosApp: boolean;
}): Promise<DevShellController> {
    const state = signal<DevShellState>({
        ready: false,
        building: null,
        port: 0,
        buildId: '',
        urls: [],
        primaryUrl: '',
        targets: opts.targets,
    });

    /** Devices-tab mode: the QR takes the whole pane instead of sitting beside the table. */
    const view = signal({ qrZoom: false });

    let bound: { actions: DevActions; shutdown: (code?: number) => void; childClosed: Promise<void> } | null = null;
    let handle: ShellHandle | null = null;

    const act = (run: (a: DevActions) => void) => {
        if (bound) run(bound.actions);
        else handle?.say('dev server is still starting…');
    };

    const waitForTeardown = () => new Promise<void>((resolve) => {
        if (!bound) return resolve();
        const timer = setTimeout(resolve, 7_000);
        void bound.childClosed.then(() => { clearTimeout(timer); resolve(); });
    });

    const urlList = () => state.urls.map((u) => (
        <box>
            <Text color="dim">{`${u.label}:  `}</Text>
            <Text color="info" underline>{u.url}</Text>
        </box>
    ));

    /** `width`/`rows` come from `planDevices` already corrected for the
     *  cursor gutter — do not re-apply `dataTableWidth` here. */
    const targetTable = (width: number, rows: number) => (
        state.targets.length === 0
            ? <Text color="dim">(none — waiting for a manual client)</Text>
            : (
                <DataTable
                    columns={TARGET_COLUMNS}
                    rows={state.targets}
                    identity={targetIdentity}
                    width={width}
                    height={rows}
                    variant="plain"
                    showFooter={false}
                />
            )
    );

    const renderDevices = (pane: ShellPane) => {
        if (!state.ready) return <Text color="dim">starting dev server…</Text>;

        // Full-pane QR, on request. Kept as a tab-local mode rather than a
        // pushed view: runShell resolves a pushed id against the registered
        // tab list, so a view that is not also a tab renders nothing — and
        // registering it as a tab would put it back in the tab strip, which
        // is exactly the duplication this replaced.
        if (view.qrZoom) {
            // The zoom exists because the QR did not fit beside the table, so
            // it cannot assume the whole pane is enough either — on an 80x24
            // terminal nothing fits, and drawing it regardless would push the
            // shell's status line off the bottom.
            const qr = fitQRToPane(state.primaryUrl, {
                width: pane.width,
                height: pane.height - QR_ZOOM_CHROME_ROWS,
            });
            return (
                <Col>
                    <Text color="dim">{QR_SCAN_LABEL}</Text>
                    {qr
                        ? <QRCode text={state.primaryUrl} quiet={qr.quiet} />
                        : (
                            <Col>
                                <Text color="warn">Terminal too small for a scannable code.</Text>
                                <Text color="dim">
                                    {`Needs ${minQRRows(state.primaryUrl)} rows of app area — open the URL below by hand, or resize.`}
                                </Text>
                            </Col>
                        )}
                    <Text color="info" underline>{state.primaryUrl}</Text>
                    <Text color="faint">esc  back</Text>
                </Col>
            );
        }

        const urls = urlList();
        // Every row of this tab is budgeted in one place — `planDevices` — and
        // its test drives the same function. The arithmetic used to live here
        // and be restated in the test, which is how the QR's label row came to
        // be charged in neither: the test agreed with the bug.
        const plan = planDevices(state.primaryUrl, pane, urls.length);
        const { placement: placed } = plan;

        if (placed.mode === 'hidden') {
            // A real bundle URL encodes to 21 rows and a pane on an 80x24
            // terminal is about 14, so this is the common case, not the edge.
            // Drawing the QR clipped would leave it unscannable while looking
            // fine, so offer the zoom and give the table the whole width.
            return (
                <Col>
                    {urls}
                    <Spacer size={1} />
                    <Row gap={2}>
                        <Text color="fg" bold>Targets</Text>
                        <Text color="faint">z  show QR</Text>
                    </Row>
                    {targetTable(plan.tableWidth, plan.tableRows)}
                </Col>
            );
        }

        return (
            <Col>
                {urls}
                <Spacer size={1} />
                <Row gap={4}>
                    <Col>
                        <Text color="dim">{QR_SCAN_LABEL}</Text>
                        {/* `quiet` must match what placeQR measured, or the
                            component renders the default and undoes the fit. */}
                        <QRCode text={state.primaryUrl} quiet={placed.qr.quiet} />
                    </Col>
                    <Col>
                        <Text color="fg" bold>Targets</Text>
                        {targetTable(plan.tableWidth, plan.tableRows)}
                    </Col>
                </Row>
            </Col>
        );
    };

    const config: ShellConfig = {
        mode: 'fullscreen',
        title: `⚡ sigx dev · ${opts.projectName}`,
        version: opts.version,
        plugins: opts.plugins,
        tabs: [
            {
                id: 'devices',
                label: 'Devices',
                render: (pane) => <Col>{renderDevices(pane)}</Col>,
            },
            {
                id: 'logs',
                label: 'Logs',
                // The pane is the terminal minus the shell's own chrome —
                // previously guessed here as `getTerminalSize().rows - 13`.
                render: (pane) => (handle
                    ? (
                        <LogView
                            store={handle.store as never}
                            width={pane.width}
                            height={logViewHeight(pane.height)}
                        />
                    )
                    : <Text color="dim">…</Text>),
            },
        ],
        shortcuts: [
            // See the reserved-keys note at the top of this file before adding.
            { key: 'r', label: 'reload', run: () => act((a) => a.reload()) },
            { key: 'd', label: 'devices', run: () => act((a) => a.showDevices()) },
            ...(opts.hasAndroidApp
                ? [{ key: 'a', label: 'android', run: () => act((a) => a.installAndroid()) }]
                : []),
            ...(opts.hasIosApp
                ? [{ key: 'i', label: 'ios', run: () => act((a) => a.buildLaunchIos()) }]
                : []),
            { key: 'q', label: 'quit', run: (shell) => shell.exit(0) },
        ],
        commands: [
            { name: '/reload', description: 'reload JS on connected devices', run: () => act((a) => a.reload()) },
            { name: '/devices', description: 'scan and launch on devices', run: () => act((a) => a.showDevices()) },
            {
                name: '/connect',
                description: 'show the pairing QR full screen',
                run: (shell) => { view.qrZoom = true; shell.switchTab('devices'); },
            },
            ...(opts.hasAndroidApp
                ? [{ name: '/android', description: 'install + launch the Android app', run: () => act((a) => a.installAndroid()) }]
                : []),
            ...(opts.hasIosApp
                ? [{ name: '/ios', description: 'build + launch the iOS app', run: () => act((a) => a.buildLaunchIos()) }]
                : []),
        ],
        status: (): StatusItem[] => {
            const items: StatusItem[] = state.ready
                ? [
                    { label: 'port', value: String(state.port), tone: 'accent' },
                    { label: 'targets', value: String(state.targets.length), tone: state.targets.length > 0 ? 'success' : 'dim' },
                ]
                : [{ label: 'status', value: 'starting…', tone: 'warn' }];
            if (state.building) items.push({ label: 'build', value: state.building, tone: 'warn' });
            return items;
        },
        onExit: async () => {
            bound?.shutdown();
            await waitForTeardown();
        },
    };

    handle = await runShell(config);

    // Tab-scoped keys. Registered on `overlay` so they beat a focused
    // DataTable/LogView, but AFTER runShell's own handler so the shell's
    // shortcuts still win — and gated on `activeTab`, which is the only
    // reliable source: the shell's 1-9 keys move tabs without telling us, so
    // a copy tracked here would desynchronise silently.
    const offKeys = onKey((key) => {
        if (handle?.activeTab !== 'devices' || !state.ready) return;
        if (key === 'z') {
            view.qrZoom = !view.qrZoom;
            return true;
        }
        if (isEsc(key) && view.qrZoom) {
            view.qrZoom = false;
            return true;
        }
    }, { layer: 'overlay' });
    handle.onExit(() => { offKeys(); });

    return {
        handle,
        state,
        bind: (b) => { bound = b; },
    };
}
