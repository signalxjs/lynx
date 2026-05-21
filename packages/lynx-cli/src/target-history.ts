/**
 * Persists the last dev-target selection per project so the picker can
 * pre-select previously used devices and Enter alone re-runs the same setup.
 *
 * Stored under `<cwd>/node_modules/.cache/@sigx/lynx-cli/last-targets.json`,
 * which is the conventional Node tool cache location and is auto-gitignored
 * via `node_modules/`. Reads and writes are best-effort — any I/O failure is
 * swallowed, since a missing or unreadable history file should never break
 * `sigx dev`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SelectedTarget } from './target-picker.js';

const FILE_VERSION = 1;

function historyPath(cwd: string): string {
    return join(cwd, 'node_modules', '.cache', '@sigx', 'lynx-cli', 'last-targets.json');
}

/**
 * Stable identity for a target, used to match remembered targets against
 * the current device list. `ios-simulator.needsBoot` is intentionally not
 * part of the key — it's a runtime fact (is the sim cold or hot right now),
 * not an identity.
 */
export function targetKey(t: SelectedTarget): string {
    switch (t.kind) {
        case 'ios-simulator': return `ios-sim:${t.udid}`;
        case 'ios-device': return `ios-dev:${t.udid}`;
        case 'android-device': return `android-dev:${t.deviceId}`;
        case 'android-avd': return `android-avd:${t.avdName}`;
    }
}

function isSelectedTarget(v: unknown): v is SelectedTarget {
    if (!v || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    switch (o.kind) {
        case 'ios-simulator':
            return typeof o.udid === 'string' && typeof o.name === 'string' && typeof o.needsBoot === 'boolean';
        case 'ios-device':
            return typeof o.udid === 'string' && typeof o.name === 'string';
        case 'android-device':
            return typeof o.deviceId === 'string';
        case 'android-avd':
            return typeof o.avdName === 'string';
        default:
            return false;
    }
}

export function readLastTargets(cwd: string): SelectedTarget[] {
    try {
        const raw = readFileSync(historyPath(cwd), 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return [];
        const obj = parsed as Record<string, unknown>;
        if (obj.version !== FILE_VERSION) return [];
        if (!Array.isArray(obj.targets)) return [];
        return obj.targets.filter(isSelectedTarget);
    } catch {
        return [];
    }
}

export function writeLastTargets(cwd: string, targets: SelectedTarget[]): void {
    try {
        const path = historyPath(cwd);
        mkdirSync(dirname(path), { recursive: true });
        const payload = JSON.stringify({ version: FILE_VERSION, targets }, null, 2);
        // Plain overwrite — history is best-effort. If the process is killed
        // mid-write, a corrupt JSON is caught by readLastTargets and treated
        // as empty, so atomicity isn't worth the cross-platform headache
        // (renameSync over an existing destination is unreliable on Windows).
        writeFileSync(path, payload, 'utf-8');
    } catch {
        // Best-effort: history is a nicety, not load-bearing.
    }
}
