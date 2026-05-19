/**
 * `sigx lynx outdated` — read-only status of @sigx/lynx-* deps.
 *
 * Lists every installed sigx package with its installed and latest version,
 * flags packages that are out of sync with each other (lockstep violation),
 * and recommends `sigx lynx upgrade` when updates are available.
 *
 * Exits with code 1 if any package is out of sync OR an update is available,
 * so this command is CI-friendly: a green build means the project is on the
 * latest, lockstepped version.
 */

import { fetchLatestVersion } from './util/registry';
import {
    findSigxDeps,
    readInstalledVersion,
    readPackageJson,
    SIGX_LYNX_PREFIX,
    type SigxDep,
} from './util/sigx-packages';

export interface OutdatedOptions {
    cwd: string;
    /** Override the registry call (used for tests). */
    fetchVersion?: (pkg: string) => string;
    /** Override the dist-tag (default `latest`). */
    tag?: string;
}

export interface OutdatedResult {
    /** Number of packages flagged as out of sync (lockstep violation). */
    outOfSync: number;
    /** Number of packages that have a newer published version. */
    updatesAvailable: number;
    /** Total @sigx/lynx-* packages found in package.json. */
    total: number;
    /** Latest version from the registry, or null if the fetch failed. */
    latest: string | null;
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

export async function runOutdated(options: OutdatedOptions): Promise<OutdatedResult> {
    const { cwd } = options;
    const pkg = readPackageJson(cwd);
    if (!pkg) {
        console.log(`\n  ${RED}✗${RESET} No package.json found in ${cwd}\n`);
        return { outOfSync: 0, updatesAvailable: 0, total: 0, latest: null };
    }

    const deps = findSigxDeps(pkg);
    if (deps.length === 0) {
        console.log(`\n  ${DIM}No ${SIGX_LYNX_PREFIX}* packages found in package.json.${RESET}\n`);
        return { outOfSync: 0, updatesAvailable: 0, total: 0, latest: null };
    }

    // Dedupe by name — a package can appear in multiple sections.
    const uniqueDeps = dedupeByName(deps);

    // One registry call covers the whole family thanks to lockstep.
    const fetcher = options.fetchVersion ?? ((p: string) => fetchLatestVersion(p, { tag: options.tag }));
    let latest: string | null = null;
    try {
        latest = fetcher('@sigx/lynx-core');
    } catch (err) {
        console.log(`\n  ${YELLOW}!${RESET} Could not reach npm registry: ${(err as Error).message}`);
        console.log(`  ${DIM}Showing installed versions only.${RESET}`);
    }

    const rows = uniqueDeps.map((dep) => {
        const installed = readInstalledVersion(cwd, dep.name) ?? dep.version;
        const status = classify(installed, latest, uniqueDeps);
        return { name: dep.name, installed, range: dep.range, status };
    });

    printTable(rows, latest);

    const outOfSync = rows.filter((r) => r.status === 'out-of-sync' || r.status === 'out-of-sync-and-update').length;
    const updatesAvailable = rows.filter((r) => r.status === 'update' || r.status === 'out-of-sync-and-update').length;

    printSummary({ total: rows.length, outOfSync, updatesAvailable, latest });

    return { total: rows.length, outOfSync, updatesAvailable, latest };
}

type Status = 'ok' | 'update' | 'out-of-sync' | 'out-of-sync-and-update' | 'unknown';

function classify(installed: string | null, latest: string | null, allDeps: SigxDep[]): Status {
    if (!installed) return 'unknown';
    const dominantInstalled = pickDominantInstalled(allDeps);
    const outOfSync = dominantInstalled !== null && installed !== dominantInstalled;
    const needsUpdate = latest !== null && installed !== latest;
    if (outOfSync && needsUpdate) return 'out-of-sync-and-update';
    if (outOfSync) return 'out-of-sync';
    if (needsUpdate) return 'update';
    return 'ok';
}

function pickDominantInstalled(deps: SigxDep[]): string | null {
    const counts = new Map<string, number>();
    for (const d of deps) {
        if (!d.version) continue;
        counts.set(d.version, (counts.get(d.version) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [v, n] of counts) {
        if (n > bestCount) { best = v; bestCount = n; }
    }
    return best;
}

function dedupeByName(deps: SigxDep[]): SigxDep[] {
    const seen = new Map<string, SigxDep>();
    for (const d of deps) {
        if (!seen.has(d.name)) seen.set(d.name, d);
    }
    return Array.from(seen.values());
}

interface Row {
    name: string;
    installed: string | null;
    range: string;
    status: Status;
}

function printTable(rows: Row[], latest: string | null): void {
    console.log(`\n  ${BOLD}@sigx/lynx-* packages${RESET}\n`);

    const nameWidth = Math.max(28, ...rows.map((r) => r.name.length)) + 2;
    const installedWidth = 12;
    const latestWidth = 10;

    const header = `  ${pad('Package', nameWidth)}${pad('Installed', installedWidth)}${pad('Latest', latestWidth)}Status`;
    console.log(`  ${DIM}${header}${RESET}`);

    for (const row of rows) {
        const installed = row.installed ?? '(not installed)';
        const latestCell = latest ?? '–';
        const status = formatStatus(row.status);
        console.log(`  ${pad(row.name, nameWidth)}${pad(installed, installedWidth)}${pad(latestCell, latestWidth)}${status}`);
    }
}

function formatStatus(status: Status): string {
    switch (status) {
        case 'ok':                       return `${GREEN}up to date${RESET}`;
        case 'update':                   return `${YELLOW}update available${RESET}`;
        case 'out-of-sync':              return `${RED}out of sync${RESET}`;
        case 'out-of-sync-and-update':   return `${RED}out of sync${RESET} · ${YELLOW}update available${RESET}`;
        case 'unknown':                  return `${DIM}unknown${RESET}`;
    }
}

function printSummary(s: { total: number; outOfSync: number; updatesAvailable: number; latest: string | null }): void {
    const parts: string[] = [`${s.total} package${s.total === 1 ? '' : 's'}`];
    if (s.outOfSync > 0) parts.push(`${RED}${s.outOfSync} out of sync${RESET}`);
    if (s.updatesAvailable > 0) parts.push(`${YELLOW}${s.updatesAvailable} update${s.updatesAvailable === 1 ? '' : 's'} available${RESET}`);
    if (s.outOfSync === 0 && s.updatesAvailable === 0) parts.push(`${GREEN}all up to date${RESET}`);

    console.log(`\n  ${parts.join(' · ')}`);

    if (s.outOfSync > 0 || s.updatesAvailable > 0) {
        const target = s.latest ?? 'latest';
        console.log(`  ${DIM}Run \`sigx lynx upgrade\` to bring everything to ${target}.${RESET}`);
    }
    console.log('');
}

function pad(s: string, width: number): string {
    if (s.length >= width) return s + ' ';
    return s + ' '.repeat(width - s.length);
}
