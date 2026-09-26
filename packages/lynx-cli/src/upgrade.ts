/**
 * `sigx lynx upgrade [--to <version-or-tag>]` — bump all @sigx/lynx-* deps
 * to a target version (default: registry `latest`), then run the project's
 * package manager to install.
 *
 * The packages the lynx family builds on move with it: `@sigx/runtime-core`,
 * `@sigx/reactivity` and the `@sigx/cli` host are set to the ranges the
 * target release itself declares. Bumping lynx alone leaves an old core at
 * the app root, which fails at startup with a bare module-link error.
 *
 * Safety rails:
 *   - Refuses to run on a dirty git tree unless --force is passed, so a
 *     failed upgrade can be cleanly rolled back with `git checkout`.
 *   - --dry-run prints the planned diff without writing or installing.
 *   - Native modules trigger a one-line "consider prebuild" hint; we never
 *     touch android/ or ios/ ourselves.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnCommandSync } from './util/spawn-command.js';
import { join } from 'node:path';
import { fetchLatestVersion, fetchPublishedDependencies } from './util/registry.js';
import {
    detectPackageManager,
    installCommand,
    type PackageManager,
} from './util/package-manager.js';
import { isDirtyTree } from './util/git.js';
import {
    findSigxDeps,
    COMPANION_SOURCES,
    hasNativeModule,
    readPackageJson,
    rewriteCompanionDeps,
    rewritePackageJson,
    type SigxDep,
} from './util/sigx-packages.js';

export interface UpgradeOptions {
    cwd: string;
    /** Target: a specific version like "0.5.0", a dist-tag like "canary", or undefined for "latest". */
    target?: string;
    dryRun?: boolean;
    /** Use ^x.y.z range instead of exact pin. Default: false. Exact pins
     *  match the lockstep invariant — a stray `pnpm add @sigx/lynx-foo`
     *  can't drift the family past the version everyone else is on. */
    caret?: boolean;
    force?: boolean;
}

export interface UpgradeResult {
    /** True if the upgrade actually applied (i.e. not a dry run that completed). */
    written: boolean;
    /** Resolved target version that we bumped to. */
    targetVersion: string;
    /** Number of package.json entries rewritten. */
    changed: number;
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';

export async function runUpgrade(options: UpgradeOptions): Promise<UpgradeResult> {
    const { cwd, dryRun = false, caret = false, force = false } = options;
    const exact = !caret;

    if (isDirtyTree(cwd) && !force && !dryRun) {
        console.log(`\n  ${RED}✗ Working tree is dirty.${RESET}`);
        console.log(`  ${DIM}Commit or stash changes first, or re-run with --force.${RESET}\n`);
        process.exit(1);
    }

    const pkg = readPackageJson(cwd);
    if (!pkg) {
        console.log(`\n  ${RED}✗ No package.json found in ${cwd}${RESET}\n`);
        process.exit(1);
    }

    const deps = findSigxDeps(pkg);
    if (deps.length === 0) {
        console.log(`\n  ${DIM}No @sigx/lynx-* packages found in package.json — nothing to do.${RESET}\n`);
        return { written: false, targetVersion: '', changed: 0 };
    }

    const targetVersion = resolveTarget(options.target);

    console.log(`\n  ${BOLD}sigx lynx upgrade${RESET} → ${BLUE}${targetVersion}${RESET}${dryRun ? `  ${DIM}(dry run)${RESET}` : ''}\n`);

    const pkgJsonPath = join(cwd, 'package.json');
    const source = readFileSync(pkgJsonPath, 'utf-8');
    const { text: lynxText, changes } = rewritePackageJson(source, deps, targetVersion, { exact });
    const { text, changes: companionChanges } = rewriteCompanionDeps(lynxText, resolveCompanionRanges(targetVersion));
    const total = changes.length + companionChanges.length;

    if (total === 0) {
        console.log(`  ${GREEN}✓${RESET} All ${deps.length} sigx packages already at ${targetVersion}.\n`);
        return { written: false, targetVersion, changed: 0 };
    }

    printDiff(changes, exact);
    for (const c of companionChanges) {
        console.log(`    ${pad(c.name, 30)}${DIM}${c.from}${RESET}  →  ${c.to}  ${DIM}(required by ${targetVersion})${RESET}`);
    }

    if (dryRun) {
        console.log(`\n  ${DIM}--dry-run: package.json not written, install skipped.${RESET}\n`);
        return { written: false, targetVersion, changed: total };
    }

    writeFileSync(pkgJsonPath, text);
    console.log(`\n  ${GREEN}✓${RESET} Updated package.json (${total} ${total === 1 ? 'entry' : 'entries'})`);

    const pm = detectPackageManager(cwd);
    runInstall(cwd, pm);

    const changedNames = changes.map((c) => c.dep.name);
    if (hasNativeModule(cwd, changedNames)) {
        console.log(`\n  ${YELLOW}!${RESET} Native modules changed.`);
        console.log(`  ${DIM}Consider running \`sigx lynx prebuild --clean\` to regenerate native projects.${RESET}\n`);
    } else {
        console.log('');
    }

    return { written: true, targetVersion, changed: total };
}

/**
 * Ranges the target lynx release declares for its companions, e.g.
 * `{ '@sigx/runtime-core': '^1.0.0', '@sigx/cli': '^0.12.0' }`. Best
 * effort: if the registry lookup fails, companions are left as they are.
 */
function resolveCompanionRanges(targetVersion: string): Record<string, string> {
    const ranges: Record<string, string> = {};
    const byDeclarer = new Map<string, Record<string, string> | null>();
    for (const { name, declaredBy } of COMPANION_SOURCES) {
        if (!byDeclarer.has(declaredBy)) {
            try {
                byDeclarer.set(declaredBy, fetchPublishedDependencies(declaredBy, targetVersion));
            } catch {
                byDeclarer.set(declaredBy, null);
                console.log(`  ${YELLOW}!${RESET} ${DIM}Could not read ${declaredBy}@${targetVersion} from the registry — leaving its companion packages unchanged.${RESET}`);
            }
        }
        const range = byDeclarer.get(declaredBy)?.[name];
        if (range) ranges[name] = range;
    }
    // The Lynx build toolchain (@lynx-js/rspeedy, template/css-extract
    // plugins, …) must satisfy @sigx/lynx-plugin's peer ranges, or npm stops
    // with ERESOLVE — and its suggested `--force` is how apps end up with
    // mismatched peers. Older templates pinned these as open `>=0.1.0`.
    try {
        const peers = fetchPublishedDependencies('@sigx/lynx-plugin', targetVersion, { field: 'peerDependencies' });
        for (const [name, range] of Object.entries(peers)) {
            if (name.startsWith('@lynx-js/')) ranges[name] = range;
        }
    } catch {
        console.log(`  ${YELLOW}!${RESET} ${DIM}Could not read @sigx/lynx-plugin@${targetVersion} peers — leaving @lynx-js/* build packages unchanged.${RESET}`);
    }
    return ranges;
}

function resolveTarget(target: string | undefined): string {
    if (!target) return fetchLatestVersion('@sigx/lynx-core');
    // A bare semver like "0.5.0" is used directly; otherwise treat as a tag.
    if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(target)) return target;
    return fetchLatestVersion('@sigx/lynx-core', { tag: target });
}

function printDiff(changes: Array<{ dep: SigxDep; newRange: string }>, exact: boolean): void {
    const width = Math.max(28, ...changes.map((c) => c.dep.name.length)) + 2;
    for (const { dep, newRange } of changes) {
        const before = dep.range;
        const after = newRange;
        console.log(`    ${pad(dep.name, width)}${DIM}${before}${RESET}  →  ${after}`);
    }
    if (!exact) {
        console.log(`\n    ${DIM}--caret: using ^ ranges (default is exact pins to match lockstep).${RESET}`);
    }
}

function runInstall(cwd: string, pm: PackageManager): void {
    const { cmd, args } = installCommand(pm);
    console.log(`\n  ${BOLD}→ ${cmd} ${args.join(' ')}${RESET}\n`);
    const result = spawnCommandSync(pm, args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) {
        console.log(`\n  ${RED}✗ Install failed (${pm} exited with code ${result.status}).${RESET}`);
        console.log(`  ${DIM}package.json was already updated — re-run \`${pm} install\` once the issue is resolved.${RESET}\n`);
        process.exit(result.status ?? 1);
    }
}

function pad(s: string, width: number): string {
    if (s.length >= width) return s + ' ';
    return s + ' '.repeat(width - s.length);
}
