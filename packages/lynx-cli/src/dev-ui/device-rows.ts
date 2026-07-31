/**
 * One row per device the machine can actually see, and what is happening to it.
 *
 * The Devices tab used to list the targets you picked at startup, which meant
 * the dashboard could not act on anything else — and the `d`/`a`/`i` keys made
 * up for that by fanning out to *every* device they could find, with no
 * selection at all. This is the model that replaces both: everything detected,
 * addressable one row at a time.
 *
 * Pure and headless. Detection and launching stay in `device-detect.ts`; this
 * only turns a `DeviceStatus` into rows and tracks per-row activity, so the
 * whole thing is testable without an emulator.
 */
import type { DeviceStatus } from '../device-detect.js';
import type { SelectedTarget } from '../target-picker.js';

export type DevicePlatform = 'android' | 'ios';
export type DeviceForm = 'device' | 'emulator' | 'simulator';

/** What the row is doing right now. `idle` is the resting state. */
export type ActivityPhase =
    | 'idle'
    | 'building'
    | 'installing'
    | 'launching'
    | 'failed';

export interface DeviceActivity {
    phase: ActivityPhase;
    /** Short label for the row, e.g. `gradle installDebug`. */
    label?: string;
    /** Most recent line of build output, for the tail under the table. */
    lastLine?: string;
    /** Set when `phase === 'failed'`. */
    error?: string;
}

export interface DeviceRow {
    /**
     * Stable, unique key. Prefixed by kind so an Android serial and an iOS
     * udid can never collide, and so the cursor stays put across a rescan.
     */
    id: string;
    platform: DevicePlatform;
    form: DeviceForm;
    /** What to launch on: adb serial, simulator udid, or device udid. */
    handle: string;
    /** Human name — model, simulator name, or the raw id as a last resort. */
    label: string;
    /** The project's own app is installed here. */
    hasApp: boolean;
    /** sigx-lynx-go is installed here (Android only). */
    hasSandbox: boolean;
    /** Detected as offline/unauthorised — listed, but not launchable. */
    offline: boolean;
    /** Picked at startup but not yet visible to adb/simctl. */
    pending: boolean;
    activity: DeviceActivity;
}

const IDLE: DeviceActivity = { phase: 'idle' };

/** Key for a picked target, in the same namespace as {@link DeviceRow.id}. */
export function targetRowId(t: SelectedTarget): string {
    switch (t.kind) {
        case 'android-device': return `android:${t.deviceId}`;
        // An AVD that has booted appears to adb under a serial like
        // `emulator-5554`, not its AVD name, so a pending AVD row cannot be
        // matched to its booted self by id. It is reconciled by label below.
        case 'android-avd': return `avd:${t.avdName}`;
        case 'ios-simulator': return `ios-sim:${t.udid}`;
        case 'ios-device': return `ios-dev:${t.udid}`;
    }
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
 * Build the row list from a detection snapshot.
 *
 * `targets` are the startup selections: any that detection has not caught up
 * with yet are appended as `pending`, so a device you asked for is visible
 * before it finishes booting rather than appearing out of nowhere later.
 *
 * `previous` carries per-row activity across a rescan — detection returns
 * fresh objects every time, and losing the spinner on a device mid-install
 * because someone pressed `d` would be its own small betrayal.
 */
export function buildDeviceRows(
    status: DeviceStatus,
    targets: readonly SelectedTarget[] = [],
    previous: readonly DeviceRow[] = [],
): DeviceRow[] {
    const activityFor = (id: string): DeviceActivity =>
        previous.find((r) => r.id === id)?.activity ?? IDLE;

    const rows: DeviceRow[] = [];

    for (const d of status.devices) {
        const id = `android:${d.id}`;
        rows.push({
            id,
            platform: 'android',
            form: d.type === 'emulator' ? 'emulator' : 'device',
            handle: d.id,
            label: d.model || d.id,
            hasApp: status.appInstalled?.get(d.id) ?? false,
            hasSandbox: status.lynxGoInstalled.get(d.id) ?? false,
            offline: d.type === 'offline',
            pending: false,
            activity: activityFor(id),
        });
    }

    for (const s of status.iosSimulators) {
        const id = `ios-sim:${s.udid}`;
        rows.push({
            id,
            platform: 'ios',
            form: 'simulator',
            handle: s.udid,
            label: s.name,
            hasApp: status.iosAppInstalled?.get(s.udid) ?? false,
            hasSandbox: false,
            offline: false,
            pending: false,
            activity: activityFor(id),
        });
    }

    for (const d of status.iosDevices) {
        const id = `ios-dev:${d.udid}`;
        rows.push({
            id,
            platform: 'ios',
            form: 'device',
            handle: d.udid,
            label: d.name,
            hasApp: status.iosDeviceAppInstalled?.get(d.udid) ?? false,
            hasSandbox: false,
            offline: false,
            pending: false,
            activity: activityFor(id),
        });
    }

    // Anything picked at startup that detection has not seen yet. Matched by
    // id where possible and by label otherwise, because a booted AVD reports
    // an `emulator-NNNN` serial rather than the AVD name it was asked for.
    const seenIds = new Set(rows.map((r) => r.id));
    const seenLabels = new Set(rows.map((r) => r.label.toLowerCase()));
    for (const t of targets) {
        const id = targetRowId(t);
        const label = targetLabel(t);
        if (seenIds.has(id) || seenLabels.has(label.toLowerCase())) continue;
        rows.push({
            id,
            platform: t.kind.startsWith('android') ? 'android' : 'ios',
            form: t.kind === 'android-avd' ? 'emulator'
                : t.kind === 'ios-simulator' ? 'simulator'
                    : 'device',
            handle: t.kind === 'android-device' ? t.deviceId
                : t.kind === 'android-avd' ? t.avdName
                    : t.udid,
            label,
            hasApp: false,
            hasSandbox: false,
            offline: false,
            pending: true,
            activity: activityFor(id),
        });
    }

    return rows;
}

/** What the status column reads, given the row and a spinner frame. */
export function statusText(row: DeviceRow, spinner: string): string {
    const a = row.activity;
    switch (a.phase) {
        case 'building': return `${spinner} ${a.label ?? 'building'}`;
        case 'installing': return `${spinner} installing`;
        case 'launching': return `${spinner} launching`;
        case 'failed': return `failed`;
        case 'idle':
            if (row.pending) return 'waiting…';
            if (row.offline) return 'offline';
            if (row.hasApp) return 'app ready';
            if (row.hasSandbox) return 'sandbox';
            return 'no app';
    }
}

/** Theme token for the status cell. */
export function statusTone(row: DeviceRow): string | undefined {
    switch (row.activity.phase) {
        case 'failed': return 'danger';
        case 'idle': break;
        default: return 'accent';
    }
    if (row.offline) return 'dim';
    if (row.pending) return 'warn';
    if (row.hasApp || row.hasSandbox) return 'success';
    return 'dim';
}

/** A row is actionable when pressing Enter on it could do anything useful. */
export function isActionable(row: DeviceRow): boolean {
    return !row.offline && !row.pending && row.activity.phase === 'idle';
}
