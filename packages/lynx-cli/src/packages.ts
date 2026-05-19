/**
 * `sigx lynx add <module>...` and `sigx lynx remove <module>...`
 *
 * `add` is version-aware: it picks the version that matches the user's
 * existing @sigx/lynx-* deps so the lockstep invariant is preserved. If
 * the project has no sigx deps yet, falls back to the registry's latest
 * tag. Short names (`camera`) auto-expand to `@sigx/lynx-camera`.
 *
 * `remove` is a thin wrapper around the package manager — no version
 * logic needed.
 */

import { spawnSync } from 'node:child_process';
import { fetchLatestVersion } from './util/registry';
import {
    addCommand as buildAddCmd,
    detectPackageManager,
    removeCommand as buildRemoveCmd,
    type PackageManager,
    type RunCommand,
} from './util/package-manager';
import { isDirtyTree } from './util/git';
import {
    dominantVersion,
    expandShortName,
    findSigxDeps,
    hasNativeModule,
    isSigxLynxName,
    readPackageJson,
} from './util/sigx-packages';

export interface AddOptions {
    cwd: string;
    /** Short names (`camera`) or full names (`@sigx/lynx-camera`). */
    modules: string[];
    exact?: boolean;
    force?: boolean;
}

export interface RemoveOptions {
    cwd: string;
    modules: string[];
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

export async function runAdd(options: AddOptions): Promise<void> {
    const { cwd, modules, exact = false, force = false } = options;

    if (modules.length === 0) {
        console.log(`\n  ${RED}✗ No module names provided.${RESET}`);
        console.log(`  ${DIM}Example: sigx lynx add camera location${RESET}\n`);
        process.exit(1);
    }

    if (isDirtyTree(cwd) && !force) {
        console.log(`\n  ${RED}✗ Working tree is dirty.${RESET}`);
        console.log(`  ${DIM}Commit or stash changes first, or re-run with --force.${RESET}\n`);
        process.exit(1);
    }

    const names = modules.map(expandShortName);
    const nonSigx = names.filter((n) => !isSigxLynxName(n));
    if (nonSigx.length > 0) {
        console.log(`\n  ${RED}✗ Only @sigx/lynx-* packages can be added with this command:${RESET}`);
        for (const n of nonSigx) console.log(`    ${n}`);
        console.log(`  ${DIM}Use your package manager directly for other packages.${RESET}\n`);
        process.exit(1);
    }

    const targetVersion = resolveTargetVersion(cwd);
    const sourceLabel = targetVersion.source === 'project'
        ? `${DIM}matching${RESET} @sigx/lynx-core@${targetVersion.version}`
        : `${DIM}registry latest${RESET} (${targetVersion.version})`;

    console.log(`\n  ${BOLD}sigx lynx add${RESET}  ${sourceLabel}\n`);

    const range = exact ? targetVersion.version : `^${targetVersion.version}`;
    const specs = names.map((n) => `${n}@${range}`);
    for (const spec of specs) console.log(`    ${GREEN}+${RESET} ${spec}`);

    const pm = detectPackageManager(cwd);
    runPm(cwd, buildAddCmd(pm, specs), pm);

    if (hasNativeModule(cwd, names)) {
        console.log(`\n  ${YELLOW}!${RESET} Native module added.`);
        console.log(`  ${DIM}Consider running \`sigx lynx prebuild\` to wire it into the native projects.${RESET}\n`);
    } else {
        console.log('');
    }
}

export async function runRemove(options: RemoveOptions): Promise<void> {
    const { cwd, modules } = options;

    if (modules.length === 0) {
        console.log(`\n  ${RED}✗ No module names provided.${RESET}`);
        console.log(`  ${DIM}Example: sigx lynx remove camera${RESET}\n`);
        process.exit(1);
    }

    const names = modules.map(expandShortName);

    console.log(`\n  ${BOLD}sigx lynx remove${RESET}\n`);
    for (const name of names) console.log(`    ${RED}-${RESET} ${name}`);

    const pm = detectPackageManager(cwd);
    runPm(cwd, buildRemoveCmd(pm, names), pm);

    if (hasNativeModule(cwd, names)) {
        console.log(`\n  ${YELLOW}!${RESET} Native module removed.`);
        console.log(`  ${DIM}Consider running \`sigx lynx prebuild --clean\` to drop it from the native projects.${RESET}\n`);
    } else {
        console.log('');
    }
}

interface ResolvedTarget {
    version: string;
    source: 'project' | 'registry';
}

function resolveTargetVersion(cwd: string): ResolvedTarget {
    const pkg = readPackageJson(cwd);
    if (pkg) {
        const existing = findSigxDeps(pkg);
        const v = dominantVersion(existing);
        if (v) return { version: v, source: 'project' };
    }
    return { version: fetchLatestVersion('@sigx/lynx-core'), source: 'registry' };
}

function runPm(cwd: string, run: RunCommand, pm: PackageManager): void {
    console.log(`\n  ${BOLD}→ ${run.cmd} ${run.args.join(' ')}${RESET}\n`);
    const result = spawnSync(run.cmd, run.args, { cwd, stdio: 'inherit', shell: true });
    if (result.status !== 0) {
        console.log(`\n  ${RED}✗ ${pm} exited with code ${result.status}.${RESET}\n`);
        process.exit(result.status ?? 1);
    }
}
