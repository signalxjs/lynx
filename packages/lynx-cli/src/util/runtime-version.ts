/**
 * Runtime-version fingerprint for OTA updates (`@sigx/lynx-updates`).
 *
 * An OTA bundle may only run on a native binary whose JS↔native contract it
 * was built against — a newly installed native module package, a Lynx SDK
 * bump, or a scaffold change all require a new store release. The fingerprint
 * is a deterministic hash of exactly those native inputs, computed at
 * prebuild, baked into the binary (Android `BuildConfig.SIGX_RUNTIME_VERSION`,
 * iOS `SigxRuntimeVersion` Info.plist key) and stamped into published update
 * manifests by `sigx updates:publish`. The updates client refuses any update
 * whose `runtimeVersion` differs from the installed binary's.
 *
 * What goes IN (changes the fingerprint):
 *   - the set of linked native-module packages and the CONTENT of their
 *     native sources + `signalx-module.json` (renames included)
 *   - the Lynx SDK version pinned in the CLI's native templates
 *   - `SCAFFOLD_NATIVE_REV` (manual bump for template/autolink changes that
 *     alter JS↔native behavior)
 *
 * What stays OUT (must NOT invalidate OTA compatibility):
 *   - app name / version / versionCode / icons / splash / signing
 *   - JS-only dependencies and the lockfile
 *   - module package.json VERSIONS — the repo is lockstep-versioned, so a
 *     JS-only release bumps every package version; hashing versions would
 *     invalidate every published update on every release. Content hashing
 *     gives the correct answer: native bytes unchanged → same fingerprint.
 *   - debug-only modules (the dev client) — they don't ship in release
 *     binaries, which is what OTA updates run on.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '../manifest.js';
import { getCliVersion, walkFiles } from './build-fingerprint.js';

/**
 * Manual revision of the native scaffold contract. Bump this when a change
 * to `templates/android`, `templates/ios`, or the autolink generators alters
 * JS↔native behavior in a way an OTA bundle could observe (new generated
 * hook semantics, changed module registration, behavior changes in the
 * built-in host screens). Do NOT bump for cosmetic template changes — every
 * bump invalidates all published OTA updates for apps that re-prebuild.
 */
export const SCAFFOLD_NATIVE_REV = 1;

/** Fingerprint algorithm tag — lets the scheme evolve without ambiguity. */
const SCHEMA_TAG = 'rv1';

/** Resolve the CLI's templates dir from both src/ and dist/ layouts. */
function templatesDir(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(here, '..', '..', 'templates'),
        join(here, '..', '..', '..', 'templates'),
    ];
    for (const c of candidates) {
        if (existsSync(c)) return c;
    }
    throw new Error('lynx-cli templates directory not found');
}

/**
 * Lynx SDK version pinned in the CLI's native template for the platform.
 * Read from the template (not the generated project) so the value tracks
 * what the next scaffold/refresh will produce. Fails loudly when the pin
 * can't be found — a silent fallback would produce fingerprints that stop
 * tracking SDK bumps.
 */
export function lynxSdkVersionFromTemplates(platform: 'android' | 'ios'): string {
    if (platform === 'android') {
        const gradle = readFileSync(
            join(templatesDir(), 'android', 'app', 'build.gradle.kts'), 'utf-8');
        const m = gradle.match(/org\.lynxsdk\.lynx:lynx:([^"']+)["']/);
        if (!m) throw new Error('Could not find Lynx SDK version in Android template build.gradle.kts');
        return m[1];
    }
    const podfile = readFileSync(join(templatesDir(), 'ios', 'Podfile'), 'utf-8');
    const m = podfile.match(/pod 'Lynx', '([^']+)'/);
    if (!m) throw new Error('Could not find Lynx pod version in iOS template Podfile');
    return m[1];
}

/** True when the manifest's platform block is debug-only (dev tooling). */
function isDebugOnly(manifest: ModuleManifest, platform: 'android' | 'ios'): boolean {
    if (manifest.type === 'dev-client') return true;
    return platform === 'android'
        ? manifest.android?.debugOnly === true
        : manifest.ios?.debugOnly === true;
}

/** Stable stringify with sorted keys (recursively). */
function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * Compute the runtime-version fingerprint for one platform.
 *
 * @param platform        Target platform.
 * @param manifests       Linked module manifests (the same list `linkAndroid`
 *                        / `linkIos` consumed).
 * @param manifestIndex   Package name → absolute `signalx-module.json` path
 *                        (from `buildManifestIndex`); used to locate each
 *                        package's native sources.
 * @param pinned          `updates.runtimeVersion` from signalx.config.ts —
 *                        returned verbatim (Expo-style manual management).
 */
export function computeRuntimeVersion(
    platform: 'android' | 'ios',
    manifests: ModuleManifest[],
    manifestIndex: Map<string, string>,
    pinned?: string,
): string {
    if (pinned) return pinned;

    const parts: string[] = [SCHEMA_TAG, `scaffold:${SCAFFOLD_NATIVE_REV}`];
    parts.push(`lynx-sdk:${lynxSdkVersionFromTemplates(platform)}`);

    const relevant = manifests
        .filter((m) => m.platforms.includes(platform) && m[platform])
        .filter((m) => !isDebugOnly(m, platform))
        .sort((a, b) => a.package.localeCompare(b.package));

    for (const manifest of relevant) {
        const block = manifest[platform]!;
        const manifestPath = manifestIndex.get(manifest.package);
        const pkgDir = manifestPath ? dirname(manifestPath) : undefined;

        // Hash the platform block of the manifest itself (registration shape,
        // permissions, hooks…), not the whole manifest, so an iOS-only edit
        // doesn't churn the Android fingerprint.
        const manifestHash = createHash('sha256')
            .update(canonicalJson(block))
            .digest('hex');

        // Hash native source CONTENT. Missing dirs hash to the empty file
        // list — combineHash encodes file names, so renames count too.
        const sourceDirs: string[] = [];
        if (block.sourceDir && pkgDir) sourceDirs.push(join(pkgDir, block.sourceDir));
        if (platform === 'android' && manifest.android?.releaseStubsDir && pkgDir) {
            sourceDirs.push(join(pkgDir, manifest.android.releaseStubsDir));
        }
        const sourceFiles = sourceDirs.flatMap((d) => walkFiles(d));
        // Strip the machine-specific prefix so the same package content
        // fingerprints identically on every machine and store layout.
        const sourceHash = createHash('sha256');
        for (const f of sourceFiles.sort()) {
            const rel = pkgDir ? f.slice(pkgDir.length).replace(/\\/g, '/') : f;
            sourceHash.update(rel);
            sourceHash.update('\0');
            try { sourceHash.update(readFileSync(f)); } catch { sourceHash.update('MISSING'); }
            sourceHash.update('\0');
        }

        parts.push(`${manifest.package}:${manifestHash}:${sourceHash.digest('hex')}`);
    }

    const digest = createHash('sha256').update(parts.join('\n')).digest('hex');
    return `fp1-${digest.slice(0, 16)}`;
}

/** Sidecar consumed by `@sigx/lynx-plugin` (build define) and `sigx updates:publish`. */
export interface RuntimeVersionsSidecar {
    android?: string;
    ios?: string;
    computedAt?: string;
    cliVersion?: string;
}

export function runtimeVersionsSidecarPath(cwd: string): string {
    return join(cwd, '.sigx', 'runtime-versions.json');
}

export function readRuntimeVersionsSidecar(cwd: string): RuntimeVersionsSidecar | null {
    try {
        return JSON.parse(readFileSync(runtimeVersionsSidecarPath(cwd), 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Merge-write the sidecar — a single-platform prebuild (`--android`) must not
 * clobber the other platform's value.
 */
export function writeRuntimeVersionsSidecar(
    cwd: string,
    platform: 'android' | 'ios',
    runtimeVersion: string,
): void {
    const path = runtimeVersionsSidecarPath(cwd);
    const existing = readRuntimeVersionsSidecar(cwd) ?? {};
    const next: RuntimeVersionsSidecar = {
        ...existing,
        [platform]: runtimeVersion,
        computedAt: new Date().toISOString(),
        cliVersion: getCliVersion(),
    };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 4) + '\n');
}
