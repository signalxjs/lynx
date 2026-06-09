/**
 * Build-input fingerprinting for fast-path skip in `ensureIosBuilt` /
 * `ensureAndroidBuilt`.
 *
 * Hashes everything that affects the resulting .app / .apk:
 *   - Sources (Swift, Kotlin, plist, manifest, gradle)
 *   - Xcode project file / gradle scripts
 *   - Resolved dependency state (Podfile.lock + the JS lockfile, so a
 *     `@sigx/*` version bump invalidates the fast path — #348)
 *   - Configuration (Debug/Release)
 *   - CLI version (templates can change between releases)
 *
 * The cache lives under `node_modules/.cache/@sigx/lynx-cli/` so it follows
 * the same lifecycle as other tool caches (cleared on `pnpm install`).
 */

import { createHash } from 'node:crypto';
import {
    readFileSync, writeFileSync, mkdirSync,
    readdirSync, existsSync, statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLockfile } from './package-manager.js';

function sha256OfFile(p: string): string {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/**
 * Content hash of the nearest lockfile, or `'none'`. Folded into every build
 * fingerprint so that bumping a dependency version + reinstalling invalidates
 * the fast path — the installed `@sigx/*` sources change without any tracked
 * source file in the project changing (signalxjs/lynx#348).
 */
function lockfileHash(cwd: string): string {
    const lock = findLockfile(cwd);
    return lock ? sha256OfFile(lock) : 'none';
}

/**
 * Walk a directory recursively, returning all file paths (deterministically
 * sorted). Missing roots return an empty list — caller decides whether that
 * counts as a fingerprint mismatch or not.
 */
export function walkFiles(root: string): string[] {
    const out: string[] = [];
    function walk(d: string): void {
        let entries;
        try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile()) out.push(p);
        }
    }
    if (existsSync(root)) {
        try {
            const s = statSync(root);
            if (s.isFile()) out.push(root);
            else walk(root);
        } catch { /* ignore */ }
    }
    return out.sort();
}

/**
 * Combine a set of file paths plus an `extras` bag into a single sha-256
 * digest. File names are encoded into the hash so a rename invalidates even
 * when content is moved.
 */
export function combineHash(files: string[], extras: Record<string, string>): string {
    const h = createHash('sha256');
    for (const f of files) {
        h.update(f);
        h.update('\0');
        try { h.update(sha256OfFile(f)); } catch { h.update('MISSING'); }
        h.update('\0');
    }
    for (const k of Object.keys(extras).sort()) {
        h.update(k);
        h.update('\0');
        h.update(extras[k]);
        h.update('\0');
    }
    return h.digest('hex');
}

/** Look up the CLI's own version. Cached after first read. */
let _cliVersion: string | null = null;
export function getCliVersion(): string {
    if (_cliVersion !== null) return _cliVersion;
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        // Works from both src/util/ and dist/util/ layouts.
        const candidates = [
            join(here, '..', '..', 'package.json'),
            join(here, '..', 'package.json'),
        ];
        for (const c of candidates) {
            if (existsSync(c)) {
                _cliVersion = JSON.parse(readFileSync(c, 'utf-8')).version ?? '0.0.0';
                return _cliVersion!;
            }
        }
    } catch { /* fall through */ }
    _cliVersion = '0.0.0';
    return _cliVersion;
}

/**
 * Compute a fingerprint over everything that affects the iOS .app for the
 * given app name + configuration. Run AFTER prebuild so generated files are
 * settled.
 */
export function fingerprintIosBuild(
    cwd: string,
    appName: string,
    configuration: 'Debug' | 'Release',
): string {
    const iosDir = join(cwd, 'ios');
    const appDir = join(iosDir, appName);
    const pbxproj = join(iosDir, `${appName}.xcodeproj`, 'project.pbxproj');
    const files = [
        ...walkFiles(appDir),     // Swift, Info.plist, Assets.xcassets, …
        ...walkFiles(pbxproj),    // walkFiles handles file-root
    ];
    const extras: Record<string, string> = {
        configuration,
        cliVersion: getCliVersion(),
        // Invalidate when an installed dependency version changes (#348).
        lockfile: lockfileHash(cwd),
    };
    // Both Podfile and Podfile.lock affect the final .app. Hashing only the
    // lock would let a Podfile-only edit (new pod added, post_install tweak)
    // slip through the fast path before `pod install` has reconciled the
    // two — meaning we'd reuse a stale build.
    const podfile = join(iosDir, 'Podfile');
    extras.podfile = existsSync(podfile) ? sha256OfFile(podfile) : 'none';
    const podfileLock = join(iosDir, 'Podfile.lock');
    extras.podfileLock = existsSync(podfileLock) ? sha256OfFile(podfileLock) : 'none';
    return combineHash(files, extras);
}

/**
 * Compute a fingerprint over everything that affects the Android .apk.
 * Run AFTER prebuild.
 */
export function fingerprintAndroidBuild(cwd: string): string {
    const androidDir = join(cwd, 'android');
    const files = [
        ...walkFiles(join(androidDir, 'app', 'src', 'main')),
        // Per-variant source sets: prebuild writes the dev-client sources and
        // the debug manifest overlay into src/debug (and release stubs into
        // src/release), so `installDebug` inputs live outside src/main too.
        ...walkFiles(join(androidDir, 'app', 'src', 'debug')),
        ...walkFiles(join(androidDir, 'app', 'src', 'release')),
        ...walkFiles(join(androidDir, 'app', 'build.gradle.kts')),
        ...walkFiles(join(androidDir, 'build.gradle.kts')),
        ...walkFiles(join(androidDir, 'settings.gradle.kts')),
        ...walkFiles(join(androidDir, 'gradle.properties')),
    ];
    return combineHash(files, {
        cliVersion: getCliVersion(),
        // Invalidate when an installed dependency version changes (#348).
        lockfile: lockfileHash(cwd),
    });
}

// ────────────────────────────────────────────────────────────────
// Cache file storage
// ────────────────────────────────────────────────────────────────

function cachePath(cwd: string, key: string): string {
    // `key` is sanitised; UDIDs and device serials contain only hex / digits / hyphens.
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(cwd, 'node_modules', '.cache', '@sigx', 'lynx-cli', `${safe}.hash`);
}

export function readCachedFingerprint(cwd: string, key: string): string | null {
    try { return readFileSync(cachePath(cwd, key), 'utf-8').trim(); } catch { return null; }
}

export function writeCachedFingerprint(cwd: string, key: string, value: string): void {
    const p = cachePath(cwd, key);
    try {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, value);
    } catch {
        // Best-effort — a missing cache file just means we rebuild once more
        // than necessary next time.
    }
}
