/**
 * Package-manager detection and command builders.
 *
 * Lockfile-first: the lockfile is authoritative for what tool owns the
 * project. Only falls back to "first binary on $PATH" when no lockfile is
 * present (e.g. a fresh project before its first install).
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

export interface RunCommand {
    cmd: string;
    args: string[];
}

/**
 * Resolve a package-manager binary name for the current platform. On
 * Windows, `pnpm`/`npm`/`yarn`/`bun` are `.cmd` shims, and we deliberately
 * avoid spawning them via `shell: true` because cmd.exe treats `^` as an
 * escape character — which silently strips the caret from semver ranges
 * like `@sigx/lynx-camera@^0.4.0` when they're passed through the shell.
 */
export function resolveBinary(pm: PackageManager): string {
    return process.platform === 'win32' ? `${pm}.cmd` : pm;
}

const LOCKFILES: Array<{ file: string; pm: PackageManager }> = [
    { file: 'pnpm-lock.yaml', pm: 'pnpm' },
    { file: 'yarn.lock', pm: 'yarn' },
    { file: 'bun.lockb', pm: 'bun' },
    { file: 'bun.lock', pm: 'bun' },
    { file: 'package-lock.json', pm: 'npm' },
];

export function detectFromLockfile(cwd: string): PackageManager | null {
    for (const { file, pm } of LOCKFILES) {
        if (existsSync(join(cwd, file))) return pm;
    }
    return null;
}

/**
 * Find the nearest lockfile at or above `cwd`, returning its absolute path (or
 * `null` if none exists up to the filesystem root). The walk matters for
 * monorepos, where the app dir (e.g. `examples/showcase`) has no lockfile of
 * its own — it lives at the workspace root. Used to fold the resolved
 * dependency set into build fingerprints so a version bump invalidates caches.
 */
export function findLockfile(cwd: string): string | null {
    let dir = cwd;
    // Walk up until we hit the filesystem root, where `dirname(dir) === dir`.
    for (;;) {
        for (const { file } of LOCKFILES) {
            const p = join(dir, file);
            if (existsSync(p)) return p;
        }
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

export function detectFromBinaries(): PackageManager | null {
    if (hasBinary('pnpm')) return 'pnpm';
    if (hasBinary('yarn')) return 'yarn';
    if (hasBinary('bun')) return 'bun';
    if (hasBinary('npm')) return 'npm';
    return null;
}

/** What tool owns this project. Lockfile wins; binaries are a fallback. */
export function detectPackageManager(cwd: string): PackageManager {
    return detectFromLockfile(cwd) ?? detectFromBinaries() ?? 'npm';
}

export function getVersion(pm: PackageManager): string | null {
    try {
        return execSync(`${pm} --version`, { stdio: 'pipe', encoding: 'utf-8' }).trim();
    } catch {
        return null;
    }
}

function hasBinary(name: string): boolean {
    try {
        execSync(`${name} --version`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

export function installCommand(pm: PackageManager): RunCommand {
    switch (pm) {
        case 'pnpm': return { cmd: 'pnpm', args: ['install'] };
        case 'npm':  return { cmd: 'npm',  args: ['install'] };
        case 'yarn': return { cmd: 'yarn', args: [] };
        case 'bun':  return { cmd: 'bun',  args: ['install'] };
    }
}

export function addCommand(pm: PackageManager, pkgs: string[]): RunCommand {
    switch (pm) {
        case 'pnpm': return { cmd: 'pnpm', args: ['add', ...pkgs] };
        case 'npm':  return { cmd: 'npm',  args: ['install', ...pkgs] };
        case 'yarn': return { cmd: 'yarn', args: ['add', ...pkgs] };
        case 'bun':  return { cmd: 'bun',  args: ['add', ...pkgs] };
    }
}

export function removeCommand(pm: PackageManager, pkgs: string[]): RunCommand {
    switch (pm) {
        case 'pnpm': return { cmd: 'pnpm', args: ['remove', ...pkgs] };
        case 'npm':  return { cmd: 'npm',  args: ['uninstall', ...pkgs] };
        case 'yarn': return { cmd: 'yarn', args: ['remove', ...pkgs] };
        case 'bun':  return { cmd: 'bun',  args: ['remove', ...pkgs] };
    }
}
