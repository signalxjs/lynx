/**
 * JDK discovery for Android builds — shared by `android-run.ts` (what gradle
 * actually runs on) and `doctor.ts` (what we tell the user), so the two can
 * never disagree.
 *
 * Gradle only runs on a bounded range of JDKs. A JDK that is too new doesn't
 * fail gracefully: e.g. Gradle 8.11 on JDK 25 died before configuring anything,
 * with nothing but the version string as its error ("What went wrong:
 * 25.0.2"). So we check the major version up front and, when JAVA_HOME / PATH
 * point at an unsupported JDK, fall back to Android Studio's bundled JBR —
 * which is always a Gradle-compatible JDK and is present on nearly every
 * machine that builds Android at all.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Gradle version pinned by `templates/android/gradle/wrapper/gradle-wrapper.properties`.
 * A test asserts the two agree, so bumping the wrapper forces a look at
 * {@link SUPPORTED_JDK}.
 */
export const GRADLE_WRAPPER_VERSION = '9.8.0';

/**
 * JDK majors the template's toolchain supports: AGP 9.4 needs ≥17; Gradle
 * 9.8 runs on 17–27 (https://docs.gradle.org/current/userguide/compatibility.html).
 * The ceiling is the newest JDK the template has actually been built on
 * (21, 25 and 26 verified in #1149) — raise it after a real build, not from
 * the matrix alone.
 */
export const SUPPORTED_JDK = { min: 17, max: 26 } as const;

export type JdkSource = 'JAVA_HOME' | 'PATH' | 'Android Studio';

export interface JdkInfo {
    source: JdkSource;
    /** JDK home directory (null only if a PATH java didn't report one). */
    home: string | null;
    /** Full version string, e.g. "21.0.5" or "1.8.0_461". */
    version: string;
    major: number;
}

export interface JdkResolution {
    /** First supported JDK in priority order, or null if none. */
    chosen: JdkInfo | null;
    /** Every JDK we could run, in priority order (chosen included). */
    found: JdkInfo[];
}

export function isSupportedJdk(major: number): boolean {
    return major >= SUPPORTED_JDK.min && major <= SUPPORTED_JDK.max;
}

export function supportedRangeLabel(): string {
    return `${SUPPORTED_JDK.min}–${SUPPORTED_JDK.max}`;
}

/** `<home>/bin/java(.exe)` */
export function javaExecutable(home: string, platform: NodeJS.Platform = process.platform): string {
    return join(home, 'bin', platform === 'win32' ? 'java.exe' : 'java');
}

/**
 * Parse `java -XshowSettings:properties -version` output (stderr). Handles
 * both the modern `openjdk version "21.0.5"` form and legacy `1.8.0_x`.
 */
export function parseJavaVersionOutput(output: string): { version: string; major: number; home: string | null } | null {
    const m = output.match(/version "([^"]+)"/) ?? output.match(/^\S+ (\d+(?:\.\d+)*)/m);
    if (!m) return null;
    const version = m[1];
    const parts = version.split(/[._+-]/).map((n) => Number(n));
    const major = parts[0] === 1 && parts.length > 1 ? parts[1] : parts[0];
    if (!Number.isFinite(major) || major <= 0) return null;
    const homeMatch = output.match(/^\s*java\.home = (.+)$/m);
    return { version, major, home: homeMatch ? homeMatch[1].trim() : null };
}

/** Run a java binary and parse its version. `null` when it can't run. */
export type JavaProbe = (javaBin: string) => ReturnType<typeof parseJavaVersionOutput>;

export const probeJava: JavaProbe = (javaBin) => {
    try {
        // No shell: `java` resolves via PATH (libuv appends .exe on Windows),
        // and quoting stays correct for paths with spaces.
        const r = spawnSync(javaBin, ['-XshowSettings:properties', '-version'], {
            encoding: 'utf-8',
            timeout: 15_000,
            windowsHide: true,
        });
        if (r.error) return null;
        return parseJavaVersionOutput(`${r.stderr ?? ''}\n${r.stdout ?? ''}`);
    } catch {
        return null;
    }
};

/**
 * Where Android Studio keeps its bundled JDK (the JBR) on each platform.
 * Includes the default install locations plus the per-user variants.
 */
export function androidStudioJdkHomes(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir(),
): string[] {
    if (platform === 'darwin') {
        return [
            '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
            '/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home',
            join(home, 'Applications/Android Studio.app/Contents/jbr/Contents/Home'),
        ];
    }
    if (platform === 'win32') {
        const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
        const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
        return [
            join(programFiles, 'Android', 'Android Studio', 'jbr'),
            join(programFiles, 'Android', 'Android Studio Preview', 'jbr'),
            join(localAppData, 'Programs', 'Android Studio', 'jbr'),
        ];
    }
    return [
        '/opt/android-studio/jbr',
        '/usr/local/android-studio/jbr',
        '/snap/android-studio/current/jbr',
        join(home, 'android-studio', 'jbr'),
    ];
}

export interface ResolveJdkOptions {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    probe?: JavaProbe;
    exists?: (path: string) => boolean;
    studioHomes?: string[];
}

/**
 * Walk JAVA_HOME → PATH → Android Studio's JBR and return the first JDK in
 * {@link SUPPORTED_JDK}, plus every JDK seen on the way (for messages).
 */
export function resolveJdk(opts: ResolveJdkOptions = {}): JdkResolution {
    const env = opts.env ?? process.env;
    const platform = opts.platform ?? process.platform;
    const probe = opts.probe ?? probeJava;
    const exists = opts.exists ?? existsSync;
    const studioHomes = opts.studioHomes ?? androidStudioJdkHomes(platform, env);

    const found: JdkInfo[] = [];
    const seenHomes = new Set<string>();
    const consider = (info: JdkInfo): JdkInfo | null => {
        const key = info.home?.toLowerCase();
        if (key) {
            if (seenHomes.has(key)) return null;
            seenHomes.add(key);
        }
        found.push(info);
        return isSupportedJdk(info.major) ? info : null;
    };

    const javaHome = env.JAVA_HOME?.trim();
    if (javaHome) {
        const bin = javaExecutable(javaHome, platform);
        const r = exists(bin) ? probe(bin) : null;
        if (r) {
            const hit = consider({ source: 'JAVA_HOME', home: javaHome, version: r.version, major: r.major });
            if (hit) return { chosen: hit, found };
        }
    }

    const onPath = probe('java');
    if (onPath) {
        const hit = consider({ source: 'PATH', home: onPath.home, version: onPath.version, major: onPath.major });
        if (hit) return { chosen: hit, found };
    }

    for (const studioHome of studioHomes) {
        const bin = javaExecutable(studioHome, platform);
        if (!exists(bin)) continue;
        const r = probe(bin);
        if (!r) continue;
        const hit = consider({ source: 'Android Studio', home: studioHome, version: r.version, major: r.major });
        if (hit) return { chosen: hit, found };
    }

    return { chosen: null, found };
}

function describe(info: JdkInfo): string {
    const where = info.source === 'Android Studio' ? "Android Studio's JDK" : info.source;
    return `${where}: JDK ${info.major}${info.home ? ` (${info.home})` : ''}`;
}

/**
 * One-line explanation for when we picked a JDK other than the one the user
 * pointed at — or null when the chosen JDK is the obvious one.
 */
export function describeJdkFallback(res: JdkResolution): string | null {
    if (!res.chosen) return null;
    const skipped = res.found.filter((j) => j !== res.chosen && !isSupportedJdk(j.major));
    if (skipped.length === 0) return null;
    const why = skipped.map((j) => `${j.source} is JDK ${j.major}`).join(', ');
    return `Using ${describe(res.chosen)} — ${why}, which Gradle ${GRADLE_WRAPPER_VERSION} can't run (needs JDK ${supportedRangeLabel()}).`;
}

/** Actionable error text for when no supported JDK exists. */
export function describeNoSupportedJdk(res: JdkResolution, platform: NodeJS.Platform = process.platform): string {
    const lines: string[] = [];
    if (res.found.length === 0) {
        lines.push('No Java runtime found. Android builds need a JDK (version ' + supportedRangeLabel() + ').');
    } else {
        lines.push(`No compatible JDK found. Android builds need JDK ${supportedRangeLabel()} (Gradle ${GRADLE_WRAPPER_VERSION}), but found:`);
        for (const j of res.found) lines.push(`  • ${describe(j)}`);
    }
    lines.push('');
    lines.push('Fix (pick one):');
    lines.push('  • Install Android Studio — its bundled JDK is detected automatically.');
    if (platform === 'win32') {
        lines.push(`  • Or point JAVA_HOME at a JDK ${supportedRangeLabel()}, e.g.  setx JAVA_HOME "C:\\Program Files\\Android\\Android Studio\\jbr"`);
        lines.push('    (then open a new terminal)');
    } else if (platform === 'darwin') {
        lines.push('  • Or install JDK 21:  brew install --cask temurin@21  and set JAVA_HOME to it');
    } else {
        lines.push('  • Or install JDK 21 (e.g. apt install openjdk-21-jdk) and set JAVA_HOME to it');
    }
    lines.push('Then run `npx sigx doctor` to confirm.');
    return lines.join('\n');
}

/**
 * The env block to hand gradle: JAVA_HOME pinned to the chosen JDK and its
 * `bin/` prepended to PATH. Uses the existing PATH key's casing — on
 * Windows it's usually `Path`, and adding a second `PATH` key leaves which
 * one the child sees up to chance.
 */
export function jdkEnv(
    chosen: JdkInfo,
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
    const out: NodeJS.ProcessEnv = { ...env };
    if (!chosen.home) return out;
    out.JAVA_HOME = chosen.home;
    const pathKey = Object.keys(out).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const delimiter = platform === 'win32' ? ';' : ':';
    out[pathKey] = `${join(chosen.home, 'bin')}${delimiter}${out[pathKey] ?? ''}`;
    return out;
}
