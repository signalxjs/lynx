/**
 * Write helpers that no-op when the destination already matches.
 *
 * Used throughout prebuild to avoid spurious mtime bumps on generated and
 * refreshed files. Identical writes would otherwise cascade into:
 *   - `pod install` running every prebuild (Podfile mtime > Podfile.lock)
 *   - Xcode/Gradle re-compiling sources whose bytes never actually changed
 *   - Rspack incremental cache misses
 */

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Write `content` to `destPath` only if the existing file differs. Returns
 * `true` if a write happened, `false` if the destination was already
 * identical (no mtime touched).
 */
export function writeFileIfChanged(destPath: string, content: string | Buffer): boolean {
    const next = typeof content === 'string' ? Buffer.from(content) : content;
    try {
        const existing = readFileSync(destPath);
        if (existing.equals(next)) return false;
    } catch {
        // Missing / unreadable — fall through to write.
    }
    writeFileSync(destPath, next);
    return true;
}

/**
 * Like `copyFileSync` but a no-op when source and destination bytes are
 * already identical. Returns `true` if a write happened.
 */
export function copyFileIfChanged(srcPath: string, destPath: string): boolean {
    const src = readFileSync(srcPath);
    try {
        const existing = readFileSync(destPath);
        if (existing.equals(src)) return false;
    } catch {
        // Missing — fall through to write.
    }
    writeFileSync(destPath, src);
    return true;
}
