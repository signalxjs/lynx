/**
 * Interactive multi-select target picker for `sigx dev`.
 *
 * Lists booted iOS simulators, connected iOS devices, connected Android
 * devices / running emulators, plus "Boot iOS simulator…" and
 * "Launch Android emulator…" expanders. User toggles with space, confirms
 * with enter, cancels with q / Esc / Ctrl+C.
 *
 * Raw-TTY implementation — no dependency on prompts libraries. The codebase
 * already drives raw stdin from {@link ./dev-server.ts}, so we match that
 * pattern.
 */

import { execSync, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';
import {
    listAndroidDevices,
    listBootedSimulators,
    listAllSimulators,
    listConnectedIosDevices,
    bootSimulator,
    getRunningAvdName,
    resolveAdb,
} from './device-detect.js';
import { targetKey } from './target-history.js';
import { multiselect, isCancel } from '@sigx/terminal';

export type SelectedTarget =
    | { kind: 'android-device'; deviceId: string; model?: string }
    | { kind: 'android-avd'; avdName: string }
    | { kind: 'ios-simulator'; udid: string; name: string; needsBoot: boolean }
    | { kind: 'ios-device'; udid: string; name: string };

export interface PickTargetsOptions {
    /** Whether android/ exists in the project. */
    hasAndroid: boolean;
    /** Whether ios/ exists *and* we're on macOS. */
    hasIos: boolean;
    /**
     * Targets the user picked in the previous run. Items whose underlying
     * identity matches one of these float to the top of their section, are
     * pre-selected, and the cursor lands on the first match — so Enter alone
     * re-runs the same selection.
     */
    lastTargets?: SelectedTarget[];
}

interface Item {
    id: string;
    label: string;
    detail?: string;
    /** Section header; not selectable. */
    header?: boolean;
    /** Target payload when the item is selected. */
    target?: SelectedTarget;
}

/** Cap on inline "available to boot/launch" entries — avoids drowning users with 30 sims in the picker. */
const AVAILABLE_LIMIT = 6;

/**
 * Approximate "last used" timestamp for a simulator. CoreSimulator updates
 * the device directory's mtime when the sim is booted, so this is a cheap
 * MRU proxy without any persistent state of our own. Missing or unreadable
 * directories return 0 so they sort to the bottom.
 */
function simMtime(udid: string): number {
    try {
        return statSync(join(homedir(), 'Library/Developer/CoreSimulator/Devices', udid)).mtimeMs;
    } catch {
        return 0;
    }
}

/** Same idea for an AVD: `~/.android/avd/<name>.avd/` mtime updates on launch. */
export function avdMtime(name: string): number {
    try {
        return statSync(join(homedir(), '.android', 'avd', `${name}.avd`)).mtimeMs;
    } catch {
        return 0;
    }
}

// ────────────────────────────────────────────────────────────────
// TTY helpers
// ────────────────────────────────────────────────────────────────

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ────────────────────────────────────────────────────────────────
// AVD discovery
// ────────────────────────────────────────────────────────────────

function findEmulatorBin(): string | null {
    const adb = resolveAdb();
    // `<sdk>/emulator/emulator` is the canonical location.
    // If we found adb, derive the SDK root from its path.
    const candidates: string[] = [];
    if (adb && adb !== 'adb') {
        // adb is at <sdk>/platform-tools/adb → emulator at <sdk>/emulator/emulator
        const sdkRoot = adb.replace(/[\\/]platform-tools[\\/]adb$/, '');
        candidates.push(join(sdkRoot, 'emulator', 'emulator'));
    }
    if (process.env.ANDROID_HOME) candidates.push(join(process.env.ANDROID_HOME, 'emulator', 'emulator'));
    if (process.env.ANDROID_SDK_ROOT) candidates.push(join(process.env.ANDROID_SDK_ROOT, 'emulator', 'emulator'));
    candidates.push('emulator');
    for (const c of candidates) {
        try {
            execSync(`"${c}" -version`, { stdio: 'pipe' });
            return c;
        } catch {
            // try next
        }
    }
    return null;
}

export function listAndroidAvds(): string[] {
    const bin = findEmulatorBin();
    if (!bin) return [];
    try {
        const out = execSync(`"${bin}" -list-avds`, { stdio: 'pipe', encoding: 'utf-8' });
        return out.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

// ────────────────────────────────────────────────────────────────
// Item assembly
// ────────────────────────────────────────────────────────────────

/** Decorate a detail string with the "last used" hint when applicable. */
function withLastUsedHint(detail: string | undefined, isLast: boolean): string | undefined {
    if (!isLast) return detail;
    return detail ? `${detail} · last used` : 'last used';
}

function buildItems(opts: PickTargetsOptions, lastKeys: Set<string>): Item[] {
    const items: Item[] = [];

    const wasLast = (t: SelectedTarget): boolean => lastKeys.has(targetKey(t));
    // Bring previously-used items to the front of each bucket, preserving the
    // existing secondary sort. Returns negative when `a` was last-used and `b`
    // wasn't, so `Array.sort` keeps original order otherwise.
    const lastFirst = <T>(a: T, b: T, used: (x: T) => boolean): number =>
        Number(used(b)) - Number(used(a));

    if (opts.hasIos) {
        items.push({ id: 'ios-header', label: 'iOS', header: true });
        const booted = [...listBootedSimulators()].sort((a, b) =>
            lastFirst(a, b, (s) => lastKeys.has(`ios-sim:${s.udid}`)),
        );
        const devices = [...listConnectedIosDevices()].sort((a, b) =>
            lastFirst(a, b, (d) => lastKeys.has(`ios-dev:${d.udid}`)),
        );

        for (const sim of booted) {
            const target: SelectedTarget = { kind: 'ios-simulator', udid: sim.udid, name: sim.name, needsBoot: false };
            items.push({
                id: `ios-sim-${sim.udid}`,
                label: `📱 ${sim.name}`,
                detail: withLastUsedHint(`booted · ${sim.runtime}`, wasLast(target)),
                target,
            });
        }
        for (const dev of devices) {
            const model = dev.model ? ` (${dev.model})` : '';
            const target: SelectedTarget = { kind: 'ios-device', udid: dev.udid, name: dev.name };
            items.push({
                id: `ios-dev-${dev.udid}`,
                label: `📲 ${dev.name}${model}`,
                detail: withLastUsedHint(dev.osVersion ? `iOS ${dev.osVersion}` : undefined, wasLast(target)),
                target,
            });
        }

        // Inline the bootable sims: previously-used first, then iPhones, then
        // MRU (CoreSimulator device-dir mtime is a cheap proxy for "last used"),
        // then by runtime.
        const available = listAllSimulators()
            .filter((s) => s.state !== 'Booted')
            .sort((a, b) => {
                const aLast = lastKeys.has(`ios-sim:${a.udid}`) ? 0 : 1;
                const bLast = lastKeys.has(`ios-sim:${b.udid}`) ? 0 : 1;
                if (aLast !== bLast) return aLast - bLast;
                const aIphone = a.name.includes('iPhone') ? 0 : 1;
                const bIphone = b.name.includes('iPhone') ? 0 : 1;
                if (aIphone !== bIphone) return aIphone - bIphone;
                const dm = simMtime(b.udid) - simMtime(a.udid);
                if (dm !== 0) return dm;
                return b.runtime.localeCompare(a.runtime);
            })
            .slice(0, AVAILABLE_LIMIT);

        if (available.length > 0) {
            items.push({ id: 'ios-avail-header', label: 'Available to boot:', header: true });
            for (const sim of available) {
                const target: SelectedTarget = { kind: 'ios-simulator', udid: sim.udid, name: sim.name, needsBoot: true };
                items.push({
                    id: `ios-avail-${sim.udid}`,
                    label: `📱 ${sim.name}`,
                    detail: withLastUsedHint(sim.runtime, wasLast(target)),
                    target,
                });
            }
        }

        if (booted.length === 0 && devices.length === 0 && available.length === 0) {
            items.push({
                id: 'ios-empty',
                label: `${DIM}(no simulators installed — open Xcode → Settings → Platforms)${RESET}`,
                header: true,
            });
        }
    }

    if (opts.hasAndroid) {
        items.push({ id: 'android-header', label: 'Android', header: true });
        const devices = [...listAndroidDevices()].sort((a, b) =>
            lastFirst(a, b, (d) => lastKeys.has(`android-dev:${d.id}`)),
        );
        const avds = listAndroidAvds();
        // Resolve running emulators (`emulator-5554` etc.) back to their AVD
        // names so we can hide them from "Available to launch". `adb devices`
        // only gives the serial, so we ask each running emulator's console.
        const runningAvdNames = new Set(
            devices
                .filter((d) => d.type === 'emulator')
                .map((d) => getRunningAvdName(d.id))
                .filter((n): n is string => n !== null),
        );

        for (const dev of devices) {
            const icon = dev.type === 'emulator' ? '📱' : '📲';
            const name = dev.model || dev.id;
            const target: SelectedTarget = { kind: 'android-device', deviceId: dev.id, model: dev.model };
            items.push({
                id: `android-dev-${dev.id}`,
                label: `${icon} ${name}`,
                detail: withLastUsedHint(dev.id, wasLast(target)),
                target,
            });
        }

        // Inline the launchable AVDs (those not already running): previously-used
        // first, then MRU.
        const launchable = avds
            .filter((avd) => !runningAvdNames.has(avd))
            .sort((a, b) => {
                const aLast = lastKeys.has(`android-avd:${a}`) ? 0 : 1;
                const bLast = lastKeys.has(`android-avd:${b}`) ? 0 : 1;
                if (aLast !== bLast) return aLast - bLast;
                return avdMtime(b) - avdMtime(a) || a.localeCompare(b);
            })
            .slice(0, AVAILABLE_LIMIT);

        if (launchable.length > 0) {
            items.push({ id: 'android-avail-header', label: 'Available to launch:', header: true });
            for (const avd of launchable) {
                const target: SelectedTarget = { kind: 'android-avd', avdName: avd };
                items.push({
                    id: `android-avd-${avd}`,
                    label: `📱 ${avd}`,
                    detail: withLastUsedHint(undefined, wasLast(target)),
                    target,
                });
            }
        }

        if (devices.length === 0 && launchable.length === 0) {
            items.push({
                id: 'android-empty',
                label: `${DIM}(no devices connected, no AVDs found — open Android Studio → Device Manager)${RESET}`,
                header: true,
            });
        }
    }

    return items;
}

// Picker — prompt-kit multiselect (section headers become option groups,
// previously-used targets are pre-selected via initialValues).
// ────────────────────────────────────────────────────────────────

const stripAnsiCodes = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

export async function pickTargets(opts: PickTargetsOptions): Promise<SelectedTarget[] | null> {
    if (!process.stdin.isTTY) return null;

    const lastKeys = new Set((opts.lastTargets ?? []).map(targetKey));
    const items = buildItems(opts, lastKeys);
    const selectable = items.filter((i) => !i.header && i.target);
    if (selectable.length === 0) {
        console.log(`
  ${DIM}(no iOS or Android targets detected — connect a device or boot a simulator)${RESET}
`);
        return [];
    }

    let group: string | undefined;
    const options: { value: string; label: string; description?: string; group?: string }[] = [];
    for (const item of items) {
        if (item.header) {
            group = stripAnsiCodes(item.label);
            continue;
        }
        if (!item.target) continue;
        options.push({
            value: item.id,
            label: stripAnsiCodes(item.label),
            description: item.detail ? stripAnsiCodes(item.detail) : undefined,
            group,
        });
    }
    const initialValues = selectable
        .filter((i) => i.target && lastKeys.has(targetKey(i.target)))
        .map((i) => i.id);

    const picked = await multiselect<string>({
        message: 'Select dev targets',
        options,
        initialValues,
    });
    if (isCancel(picked)) return null;
    return picked
        .map((id) => selectable.find((i) => i.id === id)?.target)
        .filter((t): t is SelectedTarget => !!t);
}

// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// Materialize: boot simulators / launch emulators that aren't live yet
// ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAndroidDevice(avdName: string, timeoutMs = 120_000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    // The emulator surfaces as `emulator-5554` etc. — we don't know the port
    // in advance, so we pick the first emulator we see that's fully booted.
    // Consider only emulators that came up after we started waiting.
    const alreadyRunning = new Set(listAndroidDevices().filter((d) => d.type === 'emulator').map((d) => d.id));
    const adb = resolveAdb() ?? 'adb';
    while (Date.now() < deadline) {
        const devices = listAndroidDevices();
        const candidate = devices.find((d) => d.type === 'emulator' && !alreadyRunning.has(d.id));
        if (candidate) {
            // Confirm boot completed
            try {
                const out = execSync(`"${adb}" -s ${candidate.id} shell getprop sys.boot_completed`, {
                    stdio: 'pipe',
                    encoding: 'utf-8',
                });
                if (out.trim() === '1') return candidate.id;
            } catch {
                // shell not reachable yet
            }
        }
        await sleep(2000);
    }
    return null;
}

/**
 * Boot anything in {@link targets} that isn't live yet. Returns a new
 * target list where {@link SelectedTarget} entries of kind `android-avd`
 * have been converted to `android-device` with the resolved device id,
 * and {@link SelectedTarget} entries of kind `ios-simulator` with
 * `needsBoot: true` have `needsBoot` flipped to `false` (they're live now).
 *
 * Any target that fails to come online is dropped with a warning.
 */
export async function materializeTargets(
    targets: SelectedTarget[],
    logger: Logger,
): Promise<SelectedTarget[]> {
    const out: SelectedTarget[] = [];
    for (const target of targets) {
        if (target.kind === 'ios-simulator' && target.needsBoot) {
            logger.log(`Booting ${target.name}...`);
            bootSimulator(target.udid);
            try { execSync('open -a Simulator', { stdio: 'pipe' }); } catch { /* non-fatal */ }
            out.push({ ...target, needsBoot: false });
            continue;
        }
        if (target.kind === 'android-avd') {
            const emu = findEmulatorBin();
            if (!emu) {
                logger.error(`Cannot launch AVD ${target.avdName}: emulator binary not found. Check ANDROID_HOME.`);
                continue;
            }
            logger.log(`Launching Android emulator ${target.avdName}...`);
            const child = spawn(emu, ['-avd', target.avdName], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            logger.log('Waiting for emulator to boot (this can take a minute)...');
            const deviceId = await waitForAndroidDevice(target.avdName);
            if (!deviceId) {
                logger.error(`Timed out waiting for ${target.avdName} to come online.`);
                continue;
            }
            logger.log(`\x1b[32m✓ ${target.avdName} online as ${deviceId}\x1b[0m`);
            out.push({ kind: 'android-device', deviceId, model: target.avdName });
            continue;
        }
        out.push(target);
    }
    return out;
}

