/**
 * Pre-flight check: are the installed sigx *core* packages compatible with
 * the installed lynx family?
 *
 * The lynx packages build on `@sigx/runtime-core` / `@sigx/reactivity`, and
 * some consumers (the dev dashboard's `@sigx/runtime-terminal`) take them as
 * *peer* dependencies — they use whatever copy sits at the app root. An app
 * whose package.json still pins an old core (older `sigx create` templates
 * wrote `@sigx/runtime-core ^0.7.0`) while its lynx packages moved on fails
 * at startup with a bare ES-module link error:
 *
 *   The requested module '@sigx/runtime-core/internals' does not provide an
 *   export named 'declareLiveClient'
 *
 * This check reads package.json files only (no network, no imports) and
 * turns that into "these versions don't match — here's the fix".
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isCheckableRange, satisfies } from './semver-range.js';

export const CORE_PACKAGES = ['@sigx/runtime-core', '@sigx/reactivity'] as const;

export interface CompatIssue {
    /** The package installed at an incompatible version. */
    pkg: string;
    installed: string;
    /** Range the consumer declares. */
    required: string;
    /** `name@version` of the package that needs it. */
    requiredBy: string;
}

interface Manifest {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}

function readManifest(dir: string): Manifest | null {
    try {
        return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Manifest;
    } catch {
        return null;
    }
}

/**
 * Node-style lookup of `name` from `fromDir`: the nearest
 * `node_modules/<name>` walking up. Returns the package's real directory
 * (pnpm symlinks resolved, so nested lookups continue from the store).
 */
export function findPackageDir(name: string, fromDir: string): string | null {
    let dir = fromDir;
    for (;;) {
        const candidate = join(dir, 'node_modules', name);
        if (existsSync(join(candidate, 'package.json'))) {
            try {
                return realpathSync(candidate);
            } catch {
                return candidate;
            }
        }
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Consumers whose core requirements we verify, as resolution chains from the
 * app root (`['@sigx/lynx-cli', '@sigx/terminal']` = the `@sigx/terminal`
 * that `@sigx/lynx-cli` resolves).
 */
const CONSUMER_CHAINS: string[][] = [
    ['@sigx/lynx-runtime'],
    ['@sigx/lynx'],
    ['@sigx/lynx-core'],
    ['@sigx/lynx-cli', '@sigx/terminal'],
    ['@sigx/lynx-cli', '@sigx/terminal', '@sigx/runtime-terminal'],
];

function resolveChain(cwd: string, chain: string[]): string | null {
    let from = cwd;
    let dir: string | null = null;
    for (const name of chain) {
        dir = findPackageDir(name, from);
        if (!dir) return null;
        from = dir;
    }
    return dir;
}

export function checkCoreCompat(cwd: string): CompatIssue[] {
    const issues: CompatIssue[] = [];
    const seen = new Set<string>();
    for (const chain of CONSUMER_CHAINS) {
        const consumerDir = resolveChain(cwd, chain);
        if (!consumerDir) continue;
        const consumer = readManifest(consumerDir);
        if (!consumer) continue;
        for (const core of CORE_PACKAGES) {
            const range = consumer.peerDependencies?.[core] ?? consumer.dependencies?.[core];
            if (!range || !isCheckableRange(range)) continue;
            const coreDir = findPackageDir(core, consumerDir);
            if (!coreDir) continue;
            const installed = readManifest(coreDir)?.version;
            if (!installed || satisfies(installed, range)) continue;
            const key = `${core}@${installed}→${range}`;
            if (seen.has(key)) continue;
            seen.add(key);
            issues.push({
                pkg: core,
                installed,
                required: range,
                requiredBy: `${consumer.name ?? chain[chain.length - 1]}@${consumer.version ?? '?'}`,
            });
        }
    }
    return issues;
}

/**
 * Is the running `sigx` host new enough for this lynx-cli? `@sigx/lynx-cli`
 * declares the host range it's built against; an app still pinning an old
 * `@sigx/cli` runs that old binary with a new plugin. Only an *older* host
 * is flagged — a newer one is the user being ahead, not broken.
 */
export function checkHostCompat(cwd: string, hostVersion: string | undefined): CompatIssue | null {
    if (!hostVersion) return null;
    const lynxCliDir = findPackageDir('@sigx/lynx-cli', cwd);
    if (!lynxCliDir) return null;
    const lynxCli = readManifest(lynxCliDir);
    const range = lynxCli?.dependencies?.['@sigx/cli'];
    if (!range || !isCheckableRange(range) || satisfies(hostVersion, range)) return null;
    const floor = range.match(/\d+\.\d+\.\d+/)?.[0];
    if (!floor || satisfies(hostVersion, `>=${floor}`)) return null;
    return {
        pkg: '@sigx/cli',
        installed: hostVersion,
        required: range,
        requiredBy: `@sigx/lynx-cli@${lynxCli?.version ?? '?'}`,
    };
}

/** The error text for a failed compat check. */
export function formatCompatIssues(issues: CompatIssue[]): string {
    const lines = ['Your installed @sigx packages are out of step with each other:'];
    for (const i of issues) {
        lines.push(`  • ${i.pkg} ${i.installed} is installed, but ${i.requiredBy} needs ${i.required}`);
    }
    const pins = [...new Map(issues.map((i) => [i.pkg, `${i.pkg}@"${i.required}"`])).values()].join(' ');
    lines.push('');
    lines.push('Fix: update them together —');
    lines.push('  npx sigx upgrade');
    lines.push(`  (or by hand: npm install ${pins})`);
    lines.push('Then re-run this command. `npx sigx doctor` re-checks the whole setup.');
    return lines.join('\n');
}

/**
 * Throw a readable error when core / host versions don't line up. Called at
 * the start of every command that loads the app or the dev dashboard.
 */
export function assertCompatibleInstall(cwd: string, hostVersion?: string): void {
    const issues = checkCoreCompat(cwd);
    const host = checkHostCompat(cwd, hostVersion);
    if (host) issues.push(host);
    if (issues.length > 0) throw new Error(formatCompatIssues(issues));
}
