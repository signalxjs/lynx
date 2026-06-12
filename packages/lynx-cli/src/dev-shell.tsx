/** @jsxImportSource @sigx/terminal */
/**
 * The `sigx dev` dashboard — a ShellConfig for @sigx/cli/shell's runShell.
 *
 * Tabs: Devices (QR + URLs + selected targets), Logs (LogView over the
 * shell's streaming store), Connect (large QR). Shortcuts r/d/a/i mirror the
 * legacy raw-stdin keys; /reload etc. mirror them as slash commands.
 *
 * The dev server starts AFTER the shell mounts, so server-dependent pieces
 * late-bind: `state` (signal-backed) is filled in when rspeedy reports ready,
 * and `actions`/`shutdown` are bound by startDevServer once the child exists.
 */
import { runShell, type ShellConfig } from '@sigx/cli/shell';
import type { ShellHandle, SigxPlugin, StatusItem } from '@sigx/cli/plugin';
import { signal, Text, Col, Row, QRCode, LogView, Spacer, getTerminalSize } from '@sigx/terminal';
import type { SelectedTarget } from './target-picker.js';
import type { DevActions } from './dev-server.js';

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
        case 'android-device': return `📱 ${t.model || t.deviceId}`;
        case 'android-avd': return `📱 ${t.avdName} (avd)`;
        case 'ios-simulator': return `📱 ${t.name}`;
        case 'ios-device': return `📲 ${t.name}`;
    }
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

    const config: ShellConfig = {
        mode: 'fullscreen',
        title: `⚡ sigx dev · ${opts.projectName}`,
        version: opts.version,
        plugins: opts.plugins,
        tabs: [
            {
                id: 'devices',
                label: 'Devices',
                render: () => (
                    <Col>
                        {state.ready ? (
                            <Col>
                                {state.urls.map((u) => (
                                    <box>
                                        <Text color="dim">{`${u.label}:  `}</Text>
                                        <Text color="info" underline>{u.url}</Text>
                                    </box>
                                ))}
                                <Spacer size={1} />
                                <Row gap={4}>
                                    <Col>
                                        <Text color="dim">Scan with sigx-lynx-go:</Text>
                                        <QRCode text={state.primaryUrl} />
                                    </Col>
                                    <Col>
                                        <Text color="fg" bold>Targets</Text>
                                        {state.targets.length === 0
                                            ? <Text color="dim">(none — waiting for a manual client)</Text>
                                            : state.targets.map((t) => (
                                                <box><Text color="fg">{targetLabel(t)}</Text></box>
                                            ))}
                                    </Col>
                                </Row>
                            </Col>
                        ) : (
                            <Text color="dim">starting dev server…</Text>
                        )}
                    </Col>
                ),
            },
            {
                id: 'logs',
                label: 'Logs',
                // Full-height: terminal rows minus the shell chrome
                // (title bar 3 + tabs 3 + spacer 1 + status/hints 2) and the
                // LogView's own border/footer.
                render: () => (handle
                    ? <LogView store={handle.store as never} height={Math.max(8, getTerminalSize().rows - 13)} />
                    : <Text color="dim">…</Text>),
            },
            {
                id: 'connect',
                label: 'Connect',
                render: () => (state.ready
                    ? (
                        <Col>
                            <Text color="dim">Scan with sigx-lynx-go:</Text>
                            <QRCode text={state.primaryUrl} />
                            <Text color="info" underline>{state.primaryUrl}</Text>
                        </Col>
                    )
                    : <Text color="dim">starting dev server…</Text>),
            },
        ],
        shortcuts: [
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
    return {
        handle,
        state,
        bind: (b) => { bound = b; },
    };
}
