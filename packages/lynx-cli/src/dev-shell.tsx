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
 *     already knows. So no table here sets `sortable`, and none of them sort:
 *     both are chronological, which is the order you want for a log and the
 *     natural one for a device list. If a table ever does need sorting, it has
 *     to own the state itself and drive it from a key that is not a shell
 *     shortcut — `sortable` alone would give a half-working control.
 *   - Tab-scoped keys (`z` here) are gated on `handle.activeTab` rather than
 *     registered per tab, so they cannot leak into a tab that has no meaning
 *     for them.
 */
import { runShell, type ShellConfig } from '@sigx/cli/shell';
import type { ShellHandle, ShellPane, SigxPlugin, StatusItem } from '@sigx/cli/plugin';
import {
    signal, Text, Col, Row, QRCode, LogView, DataTable, DetailList, Divider, Spacer,
    onKey, isEsc, fitLines, type TableColumn,
} from '@sigx/terminal';
import type { SelectedTarget } from './target-picker.js';
import type { DevActions } from './dev-server.js';
import {
    logViewHeight, planDevices, fitQRToPane, minQRRows, dataTableRows, dataTableWidth,
    QR_SCAN_LABEL, QR_ZOOM_CHROME_ROWS, MIN_SPLIT_ROWS,
} from './dev-ui/layout.js';
import {
    createDeviceLogStore, LEVELS, LEVEL_LABEL, LEVEL_TONE,
    type DeviceLogRecord, type DeviceLogStore, type Level,
} from './dev-ui/device-log-store.js';

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
    /** Structured device logs — the Logs tab's table. Fed by startDevServer. */
    deviceLogs: DeviceLogStore;
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

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function hhmmss(ts: number): string {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const LOG_COLUMNS: TableColumn<DeviceLogRecord>[] = [
    { key: 'time', header: 'time', width: 8, value: (r) => hhmmss(r.ts) },
    {
        key: 'lvl',
        header: 'lvl',
        width: 3,
        value: (r) => LEVEL_LABEL[r.level],
        // Per-cell colour wins over the row tone, so an error row reads red
        // with a redder level cell rather than the two fighting.
        color: (r) => LEVEL_TONE[r.level],
    },
    { key: 'device', header: 'device', width: 12, min: 6, value: (r) => `${r.platform} #${r.client}` },
    { key: 'ns', header: 'ns', width: 10, min: 4, value: (r) => r.namespace ?? '—' },
    {
        key: 'msg',
        header: 'message',
        // The only flex column: a narrow terminal should eat into the message,
        // not the timestamp. `layoutTable` marks the truncation with `…`.
        flex: true,
        min: 20,
        // `⏎n` says there is more than one line, so a stack trace never looks
        // like a one-line message that happens to be cut off.
        value: (r) => (r.lineCount > 1 ? `${r.head}  ⏎${r.lineCount}` : r.head),
    },
];

const LOG_ROW_TONE = (r: DeviceLogRecord): string | undefined => (
    r.level === 'error' ? 'danger'
        : r.level === 'warn' ? 'warn'
            : r.level === 'debug' || r.level === 'trace' ? 'dim'
                : undefined
);

/** `null` → lowest level → … → `error` → back to `null`. */
function cycleLevel(current: Level | null): Level | null {
    if (current === null) return LEVELS[0]!;
    const next = LEVELS.indexOf(current) + 1;
    return next >= LEVELS.length ? null : LEVELS[next]!;
}

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

    /**
     * Tab-local modes. Both are signals rather than `pushView` calls: the shell
     * resolves a pushed id against its registered tab list, so a view that is
     * not also a tab renders nothing (see the note in the Devices tab).
     */
    const view = signal({
        /** Devices: the QR takes the whole pane instead of sitting beside the table. */
        qrZoom: false,
        /** Logs: the selected record is expanded below (or over) the table. */
        logDetail: false,
    });

    const deviceLogs = createDeviceLogStore();
    /** The row the table cursor is on — tracked continuously via `select`. */
    const selected = signal({ record: null as DeviceLogRecord | null });

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

    const announceFilter = (shell: ShellHandle) => {
        const summary = filterSummary();
        const shown = deviceLogs.visible().length;
        shell.say(summary
            ? `logs: ${summary} — ${shown}/${deviceLogs.total()} shown`
            : `logs: no filter — ${deviceLogs.total()} shown`);
        shell.switchTab('logs');
    };

    const cycleLevelFilter = (shell: ShellHandle) => {
        deviceLogs.filter.minLevel = cycleLevel(deviceLogs.filter.minLevel);
        announceFilter(shell);
    };

    /** One command per level — see the note at the registration site. */
    const LOG_LEVEL_COMMANDS = [
        {
            name: '/level:all',
            description: 'show device logs at every level',
            run: (shell: ShellHandle) => { deviceLogs.filter.minLevel = null; announceFilter(shell); },
        },
        ...LEVELS.map((level) => ({
            name: `/level:${level}`,
            description: `show device logs at ${level} and above`,
            run: (shell: ShellHandle) => { deviceLogs.filter.minLevel = level; announceFilter(shell); },
        })),
    ];

    const filterSummary = (): string => {
        const f = deviceLogs.filter;
        const parts: string[] = [];
        if (f.minLevel) parts.push(`≥${LEVEL_LABEL[f.minLevel].toLowerCase()}`);
        if (f.platform) parts.push(f.platform);
        if (f.namespace !== null) parts.push(f.namespace === '' ? 'no-ns' : f.namespace);
        if (f.text) parts.push(`/${f.text}/`);
        return parts.join(' · ');
    };

    const renderLogDetail = (r: DeviceLogRecord, pane: ShellPane) => {
        const META_ROWS = 4;
        const body = fitLines(r.message.split('\n'), {
            width: pane.width,
            height: Math.max(1, pane.height - META_ROWS - 2 /* divider + hint */),
        });
        return (
            <Col>
                <Divider width={pane.width} label="entry" />
                <DetailList rows={[
                    { label: 'time', value: new Date(r.ts).toISOString() },
                    { label: 'device', value: `${r.platform} #${r.client}` },
                    { label: 'level', value: r.level },
                    { label: 'namespace', value: r.namespace ?? '—' },
                ]} />
                {body.map((line) => <box><Text color="fg">{line}</Text></box>)}
                <Text color="faint">esc  close</Text>
            </Col>
        );
    };

    const renderLogs = (pane: ShellPane) => {
        const rows = deviceLogs.visible();
        const detail = view.logDetail ? selected.record : null;

        // Below MIN_SPLIT_ROWS a split leaves the table too short to be worth
        // having, so the detail takes the pane instead of sharing it.
        if (detail && pane.height < MIN_SPLIT_ROWS) return renderLogDetail(detail, pane);

        const detailRows = detail ? Math.min(10, Math.floor(pane.height / 2)) : 0;
        const tableHeight = Math.max(1, pane.height - detailRows - 1 /* filter line */);

        return (
            <Col>
                <Row gap={2}>
                    <Text color="dim">{`${rows.length}/${deviceLogs.total()}`}</Text>
                    {deviceLogs.isFiltered()
                        ? <Text color="warn">{filterSummary()}</Text>
                        : <Text color="faint">l level · /ns · /platform · enter expand</Text>}
                </Row>
                <DataTable
                    columns={LOG_COLUMNS}
                    rows={rows as DeviceLogRecord[]}
                    identity={(r: DeviceLogRecord) => String(r.seq)}
                    tone={LOG_ROW_TONE}
                    width={dataTableWidth(pane.width)}
                    height={dataTableRows(tableHeight, { variant: 'plain', footer: false })}
                    variant="plain"
                    showFooter={false}
                    emptyText={deviceLogs.total() === 0
                        ? 'no device logs yet — start the app on a device'
                        : 'nothing matches this filter'}
                    onSelect={(r: DeviceLogRecord) => { selected.record = r; }}
                    onSubmit={(r: DeviceLogRecord) => { selected.record = r; view.logDetail = true; }}
                />
                {detail ? renderLogDetail(detail, { width: pane.width, height: detailRows }) : null}
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
                id: 'build',
                label: 'Build',
                // rspeedy / gradle / xcodebuild output is genuinely
                // unstructured, so it stays a text view. The pane is the
                // terminal minus the shell's own chrome — previously guessed
                // here as `getTerminalSize().rows - 13`.
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
            {
                id: 'logs',
                label: 'Logs',
                render: (pane) => renderLogs(pane),
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
            { key: 'l', label: 'level', run: (shell) => cycleLevelFilter(shell) },
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
            // Log filters.
            //
            // `runShell` dispatches on the FIRST token only and drops the rest
            // (`runCommand(trimmed.split(/\s/)[0])`), so a slash command cannot
            // take an argument. `/level warn` would silently run `/level` with
            // no idea what was asked for. Hence one command per level: the
            // palette filters by prefix, so typing `/level` lists them all with
            // descriptions — which is more discoverable than an argument would
            // have been anyway. The values that are only known at runtime
            // (platform, namespace) cycle instead, since they cannot be
            // registered ahead of time.
            ...LOG_LEVEL_COMMANDS,
            {
                name: '/platform',
                description: 'cycle the device-log platform filter',
                run: (shell) => {
                    const seen = deviceLogs.platforms();
                    const cur = deviceLogs.filter.platform;
                    const idx = cur === null ? 0 : seen.indexOf(cur) + 1;
                    deviceLogs.filter.platform = idx >= seen.length ? null : seen[idx]!;
                    announceFilter(shell);
                },
            },
            {
                name: '/ns',
                description: 'cycle the device-log namespace filter',
                run: (shell) => {
                    // `''` is a real value — "logs with no namespace" — so the
                    // cycle is [all, …seen, none].
                    const seen = [...deviceLogs.namespaces(), ''];
                    const cur = deviceLogs.filter.namespace;
                    const idx = cur === null ? 0 : seen.indexOf(cur) + 1;
                    deviceLogs.filter.namespace = idx >= seen.length ? null : seen[idx]!;
                    announceFilter(shell);
                },
            },
            {
                name: '/filters',
                description: 'clear every device-log filter',
                run: (shell) => {
                    const f = deviceLogs.filter;
                    f.minLevel = null;
                    f.platform = null;
                    f.namespace = null;
                    f.text = '';
                    announceFilter(shell);
                },
            },
            {
                name: '/clear',
                description: 'discard the collected device logs',
                run: (shell) => {
                    const n = deviceLogs.total();
                    deviceLogs.clear();
                    selected.record = null;
                    view.logDetail = false;
                    shell.say(`cleared ${n} device log${n === 1 ? '' : 's'}`);
                },
            },
        ],
        status: (): StatusItem[] => {
            const items: StatusItem[] = state.ready
                ? [
                    { label: 'port', value: String(state.port), tone: 'accent' },
                    { label: 'targets', value: String(state.targets.length), tone: state.targets.length > 0 ? 'success' : 'dim' },
                ]
                : [{ label: 'status', value: 'starting…', tone: 'warn' }];
            if (state.building) items.push({ label: 'build', value: state.building, tone: 'warn' });

            // On the Logs tab, say how much is being withheld. A filtered view
            // that looks quiet is otherwise indistinguishable from a quiet app,
            // which is the worst way to lose an hour.
            if (handle?.activeTab === 'logs') {
                const hidden = deviceLogs.hidden();
                items.push({
                    label: 'logs',
                    value: `${deviceLogs.visible().length}/${deviceLogs.total()}`,
                    tone: 'dim',
                });
                if (hidden > 0) {
                    items.push({ label: 'hidden', value: String(hidden), tone: 'warn' });
                }
            }
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
        const tab = handle?.activeTab;

        if (tab === 'devices' && state.ready) {
            if (key === 'z') {
                view.qrZoom = !view.qrZoom;
                return true;
            }
            if (isEsc(key) && view.qrZoom) {
                view.qrZoom = false;
                return true;
            }
            return;
        }

        if (tab === 'logs') {
            // Only consume Esc when the detail is actually open — the shell's
            // own Esc handler (view layer) closes the palette and pops views,
            // and swallowing it unconditionally here would break both.
            if (isEsc(key) && view.logDetail) {
                view.logDetail = false;
                return true;
            }
        }
    }, { layer: 'overlay' });
    handle.onExit(() => { offKeys(); });

    return {
        handle,
        state,
        deviceLogs,
        bind: (b) => { bound = b; },
    };
}
