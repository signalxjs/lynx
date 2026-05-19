/**
 * Minimal git helpers for the upgrade dirty-tree gate.
 *
 * Mirrors what scripts/bump-version.js does internally — we refuse to
 * rewrite package.json when the working tree has uncommitted changes so
 * users can review the diff afterwards.
 */

import { execSync } from 'node:child_process';

export function isGitRepo(cwd: string): boolean {
    try {
        execSync('git rev-parse --is-inside-work-tree', {
            cwd,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * True if `git status --porcelain` reports any changes. Returns false for
 * non-repos so callers don't have to special-case that.
 */
export function isDirtyTree(cwd: string): boolean {
    if (!isGitRepo(cwd)) return false;
    try {
        const out = execSync('git status --porcelain', {
            cwd,
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf-8',
        });
        return out.trim().length > 0;
    } catch {
        return false;
    }
}
