#!/usr/bin/env node
/**
 * Git worktree helper for parallel work — the sigx standard.
 *
 * Layout convention: the primary checkout lives at <repo>/main and every
 * worktree at <repo>/branches/<name>, on its own branch `<name>`, with
 * dependencies installed — so multiple changes (and agent sessions) can run
 * side by side without switching branches in place.
 *
 * Usage:
 *   pnpm wt new <name> [--from <branch>]
 *   pnpm wt list
 *   pnpm wt rm <name> [--force]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── small utils ────────────────────────────────────────────────────────────

function git(args, opts = {}) {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', ...opts });
}

/** Run a shell command string (cross-platform: resolves pnpm.cmd on Windows). */
function sh(command, opts = {}) {
    return spawnSync(command, { shell: true, encoding: 'utf8', ...opts });
}

// Flags that are always boolean — never consume the following token as a value
// (so `wt rm x --force` and `wt rm x --force anything` both mean force=true).
const BOOLEAN_FLAGS = new Set(['force']);

function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith('--')) {
                flags[key] = true;
            } else {
                flags[key] = next;
                i++;
            }
        } else {
            positional.push(a);
        }
    }
    return { positional, flags };
}

/** Paths of every registered worktree, via porcelain output. The main checkout is always first. */
function worktreePaths() {
    return git(['worktree', 'list', '--porcelain'])
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) => l.slice('worktree '.length).trim());
}

/** Absolute path of the primary (main) checkout, regardless of where the script runs. */
function mainCheckout() {
    return path.resolve(worktreePaths()[0]);
}

/** Worktrees live in <repo>/branches/, next to the primary checkout at <repo>/main. */
function branchesDir() {
    const main = mainCheckout();
    // Fail fast on non-standard layouts: deriving branches/ from a plain clone's
    // parent would create/delete directories outside the repo folder.
    if (path.basename(main).toLowerCase() !== 'main') {
        die(`Standard layout required: the primary checkout must live at <repo>${path.sep}main ` +
            `(found '${main}'). Re-clone it as <repo>${path.sep}main to use 'pnpm wt'.`);
    }
    return path.join(path.dirname(main), 'branches');
}

/** Resolve a path, lowercasing on Windows so comparisons match the OS's
 *  case-insensitive filesystem. `path.relative` is case-SENSITIVE even on win32,
 *  so two paths differing only in case (e.g. drive letter) would otherwise be
 *  treated as different — breaking `wt list` labels and `wt rm` safety checks. */
function normPath(p) {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Platform-correct path equality (case-insensitive on Windows). */
function samePath(a, b) {
    return normPath(a) === normPath(b);
}

/** Is `child` equal to or inside `parent`? (platform-correct) */
function isInside(child, parent) {
    const rel = path.relative(normPath(parent), normPath(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Reject names that could escape ../<name> as a path or be invalid as a git branch. */
function assertSafeName(name) {
    // Reject a leading '-' too: a name like '--force' would otherwise be parsed as
    // an option by the git commands below (and elsewhere), not as a branch name.
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..') || name.startsWith('-')) {
        die(`Invalid name '${name}' — use letters, digits, '.', '_', '-' only (no leading '-', slashes, or '..').`);
    }
    // Path-safe but still possibly invalid as a ref (e.g. 'x.lock', trailing '.') — let git decide.
    try {
        git(['check-ref-format', '--branch', name], { stdio: 'ignore' });
    } catch {
        die(`Invalid name '${name}' — not a valid git branch name.`);
    }
}

function die(msg) {
    console.error(msg);
    process.exit(1);
}

// ── commands ───────────────────────────────────────────────────────────────

function cmdNew(positional, flags) {
    const name = positional[0];
    if (!name) die('Usage: pnpm wt new <name> [--from <branch>]');
    assertSafeName(name);

    const worktree = path.join(branchesDir(), name);
    if (existsSync(worktree)) die(`Path already exists: ${worktree}`);

    // 1. Create the worktree. Always create a NEW branch `name` (a branch can't be
    //    checked out in two worktrees), optionally based on `--from` (else HEAD).
    if (flags.from === true) die('--from requires a branch name: pnpm wt new <name> --from <branch>');
    // Never let a --from value be parsed as a git option.
    if (flags.from && String(flags.from).startsWith('-')) die(`Invalid --from value '${flags.from}' — must be a branch/ref, not an option.`);

    console.log(`Creating worktree at ${worktree}…`);
    mkdirSync(branchesDir(), { recursive: true });
    const addArgs = ['worktree', 'add', '-b', name, worktree];
    if (flags.from) addArgs.push(String(flags.from));
    try {
        git(addArgs, { stdio: 'inherit' });
    } catch {
        die(`'git worktree add' failed (branch '${name}' may already exist) — see git's output above.`);
    }

    // 2. Install deps (pnpm hardlinks from the global store — fast).
    console.log('Installing dependencies (pnpm install)…');
    const install = sh('pnpm install', { cwd: worktree, stdio: 'inherit' });
    if (install.status !== 0) {
        die(`Worktree created at ${worktree}, but 'pnpm install' failed — fix and re-run it there.`);
    }

    console.log(`\n✓ Worktree '${name}' ready.\nNext:`);
    console.log(`  cd "${worktree}"`);
    console.log('  pnpm typecheck   # plus the repo\'s test/build scripts, to verify the checkout works');
    console.log('  # …or launch an agent session from that directory for isolated parallel work.');
}

function cmdList() {
    const main = mainCheckout();
    for (const wt of worktreePaths()) {
        console.log(`${wt}${samePath(wt, main) ? '  (main)' : ''}`);
    }
}

function cmdRm(positional, flags) {
    const name = positional[0];
    if (!name) die('Usage: pnpm wt rm <name> [--force]');
    assertSafeName(name);
    const worktree = path.join(branchesDir(), name);
    if (samePath(worktree, mainCheckout())) die('Refusing to remove the main checkout.');
    // Only operate on registered worktrees — never delete an arbitrary sibling directory.
    if (!worktreePaths().some((wt) => samePath(wt, worktree))) {
        die(`'${name}' is not a registered worktree (see 'pnpm wt list').`);
    }
    // Don't saw off the branch we're sitting on — deleting the checkout we run from
    // would leave the process (and any shell/agent session) in a half-deleted directory.
    if (isInside(process.cwd(), worktree)) {
        die(`Refusing to remove the worktree you are currently in — run this from another checkout.`);
    }

    // Options before the path: `git worktree remove [--force] <worktree>`.
    const args = ['worktree', 'remove'];
    if (flags.force) args.push('--force');
    args.push(worktree);
    try {
        git(args, { stdio: 'inherit' });
    } catch {
        // On Windows, git often fails to delete pnpm's node_modules (symlinks/junctions
        // → "Function not implemented"). Finish the deletion ourselves and prune.
        if (existsSync(path.join(worktree, '.git')) && !flags.force) {
            die(`git refused to remove '${name}' (dirty?) — re-run with --force if you mean it.`);
        }
        console.warn('  ⚠ git could not fully delete the directory — removing it directly…');
        rmSync(worktree, { recursive: true, force: true });
    }
    git(['worktree', 'prune']);
    console.log(`✓ Removed worktree '${name}'.`);
}

// ── entry ──────────────────────────────────────────────────────────────────

const [sub, ...rest] = process.argv.slice(2);
const { positional, flags } = parseArgs(rest);

switch (sub) {
    case 'new':
        cmdNew(positional, flags);
        break;
    case 'list':
        cmdList();
        break;
    case 'rm':
    case 'remove':
        cmdRm(positional, flags);
        break;
    default:
        die('Usage: pnpm wt <new|list|rm> …\n' +
            '  pnpm wt new <name> [--from <branch>]\n' +
            '  pnpm wt list\n' +
            '  pnpm wt rm <name> [--force]');
}
