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
import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';
import {
    listAndroidDevices,
    listBootedSimulators,
    listAllSimulators,
    listConnectedIosDevices,
    bootSimulator,
    resolveAdb,
} from './device-detect.js';

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
}

interface Item {
    id: string;
    label: string;
    detail?: string;
    /** Section header; not selectable. */
    header?: boolean;
    /** When confirmed, this item expands into a sub-picker instead of resolving directly. */
    expander?: 'ios-boot' | 'android-avd';
    /** Target payload when the item resolves directly. */
    target?: SelectedTarget;
}

// ────────────────────────────────────────────────────────────────
// TTY helpers
// ────────────────────────────────────────────────────────────────

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function clearLines(n: number): string {
    if (n <= 0) return '';
    // Move up n lines, clear from cursor to end of screen
    return `\x1b[${n}F\x1b[J`;
}

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

function buildItems(opts: PickTargetsOptions): Item[] {
    const items: Item[] = [];

    if (opts.hasIos) {
        items.push({ id: 'ios-header', label: 'iOS', header: true });
        const booted = listBootedSimulators();
        const devices = listConnectedIosDevices();
        if (booted.length === 0 && devices.length === 0) {
            items.push({
                id: 'ios-empty',
                label: `${DIM}(no booted simulators, no connected devices)${RESET}`,
                header: true,
            });
        }
        for (const sim of booted) {
            items.push({
                id: `ios-sim-${sim.udid}`,
                label: `📱 ${sim.name}`,
                detail: `booted · ${sim.runtime}`,
                target: { kind: 'ios-simulator', udid: sim.udid, name: sim.name, needsBoot: false },
            });
        }
        for (const dev of devices) {
            const model = dev.model ? ` (${dev.model})` : '';
            items.push({
                id: `ios-dev-${dev.udid}`,
                label: `📲 ${dev.name}${model}`,
                detail: dev.osVersion ? `iOS ${dev.osVersion}` : undefined,
                target: { kind: 'ios-device', udid: dev.udid, name: dev.name },
            });
        }
        items.push({
            id: 'ios-boot',
            label: '＋ Boot iOS simulator…',
            expander: 'ios-boot',
        });
    }

    if (opts.hasAndroid) {
        items.push({ id: 'android-header', label: 'Android', header: true });
        const devices = listAndroidDevices();
        const avds = listAndroidAvds();
        const runningAvdIds = new Set(devices.filter((d) => d.type === 'emulator').map((d) => d.id));
        if (devices.length === 0 && avds.length === 0) {
            items.push({
                id: 'android-empty',
                label: `${DIM}(no devices connected, no AVDs found)${RESET}`,
                header: true,
            });
        }
        for (const dev of devices) {
            const icon = dev.type === 'emulator' ? '📱' : '📲';
            const name = dev.model || dev.id;
            items.push({
                id: `android-dev-${dev.id}`,
                label: `${icon} ${name}`,
                detail: dev.id,
                target: { kind: 'android-device', deviceId: dev.id, model: dev.model },
            });
        }
        // Only offer the expander if we actually have AVDs that aren't already running
        const offlineAvds = avds.filter((avd) => !runningAvdIds.has(`emulator-${avd}`));
        if (offlineAvds.length > 0) {
            items.push({
                id: 'android-avd',
                label: '＋ Launch Android emulator…',
                expander: 'android-avd',
            });
        }
    }

    return items;
}

// ────────────────────────────────────────────────────────────────
// Rendering + input loop
// ────────────────────────────────────────────────────────────────

function render(items: Item[], cursor: number, selected: Set<string>, title: string): string {
    const lines: string[] = [];
    lines.push('');
    lines.push(`  ${BOLD}${title}${RESET}`);
    lines.push(`  ${DIM}↑↓ move · space toggle · enter confirm · q cancel${RESET}`);
    lines.push('');
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.header) {
            lines.push(`  ${DIM}${item.label}${RESET}`);
            continue;
        }
        const isCursor = i === cursor;
        const pointer = isCursor ? `${CYAN}❯${RESET}` : ' ';
        const box = selected.has(item.id)
            ? `${GREEN}[x]${RESET}`
            : '[ ]';
        const labelText = isCursor ? `${BOLD}${item.label}${RESET}` : item.label;
        const detail = item.detail ? `  ${DIM}${item.detail}${RESET}` : '';
        lines.push(`  ${pointer} ${box} ${labelText}${detail}`);
    }
    lines.push('');
    return lines.join('\n') + '\n';
}

function nextSelectable(items: Item[], from: number, dir: 1 | -1): number {
    const n = items.length;
    for (let step = 1; step <= n; step++) {
        const i = ((from + step * dir) % n + n) % n;
        const item = items[i];
        if (!item.header) return i;
    }
    return from;
}

/**
 * Run a single-select sub-picker. Returns the selected item's target or null.
 */
async function singleSelect(title: string, items: Item[]): Promise<Item | null> {
    if (items.length === 0) return null;
    if (!process.stdin.isTTY) return null;

    let cursor = 0;
    while (items[cursor]?.header) cursor++;

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    process.stdout.write(HIDE_CURSOR);

    let linesRendered = 0;
    const draw = () => {
        const out = render(items, cursor, new Set(), title);
        process.stdout.write(clearLines(linesRendered) + out);
        linesRendered = out.split('\n').length - 1;
    };
    draw();

    return new Promise<Item | null>((resolve) => {
        const onData = (key: string) => {
            if (key === '\r' || key === '\n') {
                cleanup();
                resolve(items[cursor]);
                return;
            }
            if (key === '\x03' || key === 'q' || key === '\x1b') {
                cleanup();
                resolve(null);
                return;
            }
            if (key === '\x1b[A' || key === 'k') {
                cursor = nextSelectable(items, cursor, -1);
                draw();
                return;
            }
            if (key === '\x1b[B' || key === 'j') {
                cursor = nextSelectable(items, cursor, 1);
                draw();
                return;
            }
        };
        const cleanup = () => {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            process.stdout.write(SHOW_CURSOR);
        };
        stdin.on('data', onData);
    });
}

// ────────────────────────────────────────────────────────────────
// Main entry
// ────────────────────────────────────────────────────────────────

export async function pickTargets(opts: PickTargetsOptions): Promise<SelectedTarget[] | null> {
    if (!process.stdin.isTTY) return null;

    const items = buildItems(opts);
    // Nothing selectable at all — don't prompt, just signal empty.
    const selectable = items.filter((i) => !i.header);
    if (selectable.length === 0) {
        console.log(`\n  ${DIM}(no iOS or Android targets detected — connect a device or boot a simulator)${RESET}\n`);
        return [];
    }

    let cursor = 0;
    while (items[cursor]?.header) cursor++;
    const selected = new Set<string>();

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    process.stdout.write(HIDE_CURSOR);

    let linesRendered = 0;
    const draw = () => {
        const out = render(items, cursor, selected, 'Select dev targets');
        process.stdout.write(clearLines(linesRendered) + out);
        linesRendered = out.split('\n').length - 1;
    };
    draw();

    const picked = await new Promise<Item[] | null>((resolve) => {
        const onData = (key: string) => {
            if (key === '\r' || key === '\n') {
                cleanup();
                resolve(Array.from(selected).map((id) => items.find((i) => i.id === id)!));
                return;
            }
            if (key === '\x03' || key === 'q' || key === '\x1b') {
                cleanup();
                resolve(null);
                return;
            }
            if (key === ' ') {
                const item = items[cursor];
                if (!item.header) {
                    if (selected.has(item.id)) selected.delete(item.id);
                    else selected.add(item.id);
                    draw();
                }
                return;
            }
            if (key === 'a' || key === 'A') {
                // toggle all: if everything currently selectable is selected, clear; else select all
                const allIds = items.filter((i) => !i.header).map((i) => i.id);
                const allSelected = allIds.every((id) => selected.has(id));
                selected.clear();
                if (!allSelected) for (const id of allIds) selected.add(id);
                draw();
                return;
            }
            if (key === '\x1b[A' || key === 'k') {
                cursor = nextSelectable(items, cursor, -1);
                draw();
                return;
            }
            if (key === '\x1b[B' || key === 'j') {
                cursor = nextSelectable(items, cursor, 1);
                draw();
                return;
            }
        };
        const cleanup = () => {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            process.stdout.write(SHOW_CURSOR);
        };
        stdin.on('data', onData);
    });

    if (picked === null) return null;

    // Resolve expanders into concrete targets
    const result: SelectedTarget[] = [];
    for (const item of picked) {
        if (item.expander === 'ios-boot') {
            const sims = listAllSimulators()
                .filter((s) => s.state !== 'Booted')
                .sort((a, b) => {
                    // iPhone first, then latest runtime first
                    const aIphone = a.name.includes('iPhone') ? 0 : 1;
                    const bIphone = b.name.includes('iPhone') ? 0 : 1;
                    if (aIphone !== bIphone) return aIphone - bIphone;
                    return b.runtime.localeCompare(a.runtime);
                });
            const subItems: Item[] = sims.map((s) => ({
                id: `sim-${s.udid}`,
                label: `📱 ${s.name}`,
                detail: s.runtime,
                target: { kind: 'ios-simulator', udid: s.udid, name: s.name, needsBoot: true },
            }));
            if (subItems.length === 0) continue;
            const chosen = await singleSelect('Boot which iOS simulator?', subItems);
            if (chosen?.target) result.push(chosen.target);
            continue;
        }
        if (item.expander === 'android-avd') {
            const devices = listAndroidDevices();
            const runningAvdIds = new Set(devices.filter((d) => d.type === 'emulator').map((d) => d.id));
            const avds = listAndroidAvds().filter((avd) => !runningAvdIds.has(`emulator-${avd}`));
            const subItems: Item[] = avds.map((avd) => ({
                id: `avd-${avd}`,
                label: `📱 ${avd}`,
                target: { kind: 'android-avd', avdName: avd },
            }));
            if (subItems.length === 0) continue;
            const chosen = await singleSelect('Launch which Android emulator?', subItems);
            if (chosen?.target) result.push(chosen.target);
            continue;
        }
        if (item.target) result.push(item.target);
    }

    return result;
}

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

