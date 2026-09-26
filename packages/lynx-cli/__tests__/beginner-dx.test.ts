/**
 * Tests for the onboarding / environment helpers (#1147): JDK discovery and
 * range check, gradle failure diagnosis, shell-free command spawning, core
 * version compatibility, semver range matching, companion-dep rewrites and
 * doctor's classification.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    GRADLE_WRAPPER_VERSION,
    SUPPORTED_JDK,
    describeJdkFallback,
    describeNoSupportedJdk,
    javaExecutable,
    jdkEnv,
    parseJavaVersionOutput,
    resolveJdk,
    type JavaProbe,
} from '../src/util/jdk.js';
import { diagnoseGradleFailure, extractWhatWentWrong, formatGradleFailure } from '../src/util/gradle-diagnose.js';
import { commandInvocation, quoteCmdArg } from '../src/util/spawn-command.js';
import { isCheckableRange, satisfies } from '../src/util/semver-range.js';
import { checkCoreCompat, checkHostCompat, formatCompatIssues } from '../src/util/core-compat.js';
import { isSigxLynxName, rewriteCompanionDeps } from '../src/util/sigx-packages.js';
import { defaultAndroidSdkRoots } from '../src/util/android-sdk.js';
import { checkNode, classifyJdk } from '../src/doctor.js';

// The exact output from the user report (JDK 25 on JAVA_HOME, Gradle 8.11.1).
const JDK25_GRADLE_OUTPUT = [
    'FAILURE: Build failed with an exception.',
    '',
    '* What went wrong:',
    '25.0.2',
    '',
    '* Try:',
    '> Run with --stacktrace option to get the stack trace.',
    '> Run with --info or --debug option to get more log output.',
    '> Run with --scan to get full insights.',
    '> Get more help at https://help.gradle.org.',
    '',
    'BUILD FAILED in 1s',
].join('\r\n');

describe('JDK discovery', () => {
    it('parses modern and legacy `java -version` output', () => {
        const modern = 'Property settings:\n    java.home = C:\\jdk-21\n\nopenjdk version "21.0.5" 2024-10-15\n';
        expect(parseJavaVersionOutput(modern)).toEqual({ version: '21.0.5', major: 21, home: 'C:\\jdk-21' });
        expect(parseJavaVersionOutput('java version "1.8.0_461"')?.major).toBe(8);
        expect(parseJavaVersionOutput('openjdk version "25.0.4.1" 2026-08-18 LTS')?.major).toBe(25);
        expect(parseJavaVersionOutput('openjdk version "17" 2021-09-14')?.major).toBe(17);
        expect(parseJavaVersionOutput('command not found')).toBeNull();
    });

    it('uses java.exe on Windows', () => {
        expect(javaExecutable('C:\\jdk', 'win32').endsWith('java.exe')).toBe(true);
        expect(javaExecutable('/opt/jdk', 'linux').endsWith('java')).toBe(true);
        expect(javaExecutable('/opt/jdk', 'linux').endsWith('.exe')).toBe(false);
    });

    const probeFrom = (table: Record<string, number>): JavaProbe => (rawBin) => {
        const bin = rawBin.replace(/\\/g, '/');
        for (const [key, major] of Object.entries(table)) {
            if (bin === key || bin.startsWith(key)) {
                return { version: `${major}.0.1`, major, home: bin === 'java' ? '/path-jdk' : null };
            }
        }
        return null;
    };

    it('skips a JAVA_HOME JDK that Gradle cannot run and falls back to Android Studio', () => {
        const res = resolveJdk({
            env: { JAVA_HOME: '/jdk25' },
            platform: 'linux',
            exists: () => true,
            studioHomes: ['/studio/jbr'],
            probe: probeFrom({ '/jdk25': 25, '/studio/jbr': 21 }),
        });
        expect(res.chosen?.source).toBe('Android Studio');
        expect(res.chosen?.major).toBe(21);
        expect(res.found.map((j) => j.major)).toEqual([25, 21]);
        expect(describeJdkFallback(res)).toContain('JAVA_HOME is JDK 25');
    });

    it('prefers a supported JAVA_HOME and says nothing about it', () => {
        const res = resolveJdk({
            env: { JAVA_HOME: '/jdk21' },
            platform: 'linux',
            exists: () => true,
            studioHomes: ['/studio/jbr'],
            probe: probeFrom({ '/jdk21': 21, java: 8 }),
        });
        expect(res.chosen?.source).toBe('JAVA_HOME');
        expect(describeJdkFallback(res)).toBeNull();
    });

    it('rejects a too-old PATH java (e.g. Java 8) and keeps looking', () => {
        const res = resolveJdk({
            env: {},
            platform: 'linux',
            exists: () => true,
            studioHomes: ['/studio/jbr'],
            probe: probeFrom({ java: 8, '/studio/jbr': 21 }),
        });
        expect(res.chosen?.source).toBe('Android Studio');
    });

    it('reports every JDK it found when none is supported', () => {
        const res = resolveJdk({
            env: { JAVA_HOME: '/jdk25' },
            platform: 'linux',
            exists: () => true,
            studioHomes: [],
            probe: probeFrom({ '/jdk25': 25 }),
        });
        expect(res.chosen).toBeNull();
        const msg = describeNoSupportedJdk(res, 'win32');
        expect(msg).toContain('JDK 25');
        expect(msg).toContain(`JDK ${SUPPORTED_JDK.min}–${SUPPORTED_JDK.max}`);
        expect(msg).toContain('Android Studio');
    });

    it('prepends the chosen JDK to the existing PATH key (keeps Windows `Path` casing)', () => {
        const env = jdkEnv(
            { source: 'Android Studio', home: 'C:\\Studio\\jbr', version: '21.0.5', major: 21 },
            { Path: 'C:\\Windows' },
            'win32',
        );
        expect(env.JAVA_HOME).toBe('C:\\Studio\\jbr');
        expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['Path']);
        expect(env.Path).toMatch(/jbr[\\/]bin;C:\\Windows$/);
    });

    it('SUPPORTED_JDK matches the Gradle wrapper the template ships', () => {
        const props = readFileSync(fileURLToPath(new URL('../templates/android/gradle/wrapper/gradle-wrapper.properties', import.meta.url)), 'utf-8');
        // Bumping the wrapper? Re-check the JDK range against
        // https://docs.gradle.org/current/userguide/compatibility.html and
        // update GRADLE_WRAPPER_VERSION + SUPPORTED_JDK together.
        expect(props).toContain(`gradle-${GRADLE_WRAPPER_VERSION}-`);
    });
});

describe('gradle failure diagnosis', () => {
    it('extracts the "What went wrong" block', () => {
        expect(extractWhatWentWrong(JDK25_GRADLE_OUTPUT)).toBe('25.0.2');
    });

    it('maps the bare-version failure to a JDK fix', () => {
        const diag = diagnoseGradleFailure(JDK25_GRADLE_OUTPUT, { jdkMajor: 25 });
        expect(diag.reason).toBe('25.0.2');
        expect(diag.hint).toContain('JDK 25');
        expect(diag.hint).toContain('JAVA_HOME');
        const msg = formatGradleFailure(diag);
        expect(msg.startsWith('Android build failed: 25.0.2')).toBe(true);
        expect(msg).toContain('--verbose');
        expect(formatGradleFailure(diag, { verbose: true })).not.toContain('--verbose');
    });

    it('recognises signature mismatch, missing device, SDK, licenses', () => {
        expect(diagnoseGradleFailure('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package com.x signatures do not match]', { applicationId: 'com.x' }).hint)
            .toContain('adb uninstall com.x');
        expect(diagnoseGradleFailure('* What went wrong:\nExecution failed for task \':app:installDebug\'.\n> com.android.builder.testing.api.DeviceException: No connected devices!\n').hint)
            .toContain('emulator');
        expect(diagnoseGradleFailure('* What went wrong:\nSDK location not found. Define a valid SDK location').hint).toContain('ANDROID_HOME');
        expect(diagnoseGradleFailure('Failed to install the following Android SDK packages as some licences have not been accepted.').hint)
            .toContain('--licenses');
    });

    it('still reports gradle\'s reason for failures it does not know', () => {
        const diag = diagnoseGradleFailure('* What went wrong:\nSomething odd happened.\n\n* Try:\n');
        expect(diag).toEqual({ reason: 'Something odd happened.', hint: null });
        expect(formatGradleFailure(diag)).toContain('Android build failed: Something odd happened.');
    });
});

describe('shell-free command spawning', () => {
    it('spawns directly on POSIX', () => {
        expect(commandInvocation('./gradlew', ['installDebug'], 'darwin')).toEqual({ file: './gradlew', args: ['installDebug'], options: {} });
    });

    it('routes through cmd.exe with a quoted command line on Windows', () => {
        const inv = commandInvocation('D:\\my app\\android\\gradlew.bat', ['installDebug'], 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' });
        expect(inv.file).toBe('C:\\Windows\\system32\\cmd.exe');
        expect(inv.args).toEqual(['/d', '/s', '/c', '""D:\\my app\\android\\gradlew.bat" installDebug"']);
        expect(inv.options.windowsVerbatimArguments).toBe(true);
    });

    it('quotes tokens cmd.exe would otherwise interpret', () => {
        expect(quoteCmdArg('rspeedy')).toBe('rspeedy');
        expect(quoteCmdArg('--environment')).toBe('--environment');
        expect(quoteCmdArg('^1.0.0')).toBe('"^1.0.0"');
        expect(quoteCmdArg('a&b')).toBe('"a&b"');
        expect(quoteCmdArg('')).toBe('""');
    });
});

describe('semver ranges', () => {
    it.each([
        ['1.0.1', '^1.0.0', true],
        ['0.7.0', '^1.0.0', false],
        ['0.12.3', '^0.12.0', true],
        ['0.13.0', '^0.12.0', false],
        ['0.0.4', '^0.0.3', false],
        ['1.2.9', '~1.2.3', true],
        ['1.3.0', '~1.2.3', false],
        ['0.9.0', '>=0.9.0', true],
        ['0.8.9', '>=0.9.0', false],
        ['1.5.0', '>=1.0.0 <2.0.0', true],
        ['2.0.0', '>=1.0.0 <2.0.0', false],
        ['0.15.0', '^0.14.0 || ^0.15.0', true],
        ['1.2.0', '1.x', true],
        ['1.0.0-beta.1', '^1.0.0', true],
        ['1.2.3', '1.2.3', true],
    ])('%s satisfies %s → %s', (version, range, expected) => {
        expect(satisfies(version, range)).toBe(expected);
    });

    it('declines protocol ranges and tags', () => {
        expect(isCheckableRange('catalog:')).toBe(false);
        expect(isCheckableRange('workspace:^')).toBe(false);
        expect(isCheckableRange('latest')).toBe(false);
        expect(isCheckableRange('^1.0.0')).toBe(true);
        expect(isCheckableRange('>=1.0.0 <2')).toBe(true);
    });
});

describe('core version compatibility', () => {
    let dir: string;
    const pkg = (path: string, manifest: Record<string, unknown>) => {
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, 'package.json'), JSON.stringify(manifest));
    };
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'sigx-core-compat-'));
        pkg(dir, { name: 'app' });
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('flags a stale root core that a peer-dependent consumer picks up', () => {
        // Old template: @sigx/runtime-core ^0.7.0 at the root; the dev
        // dashboard's runtime-terminal peers on ^1.0.0 and resolves the root.
        pkg(join(dir, 'node_modules/@sigx/runtime-core'), { name: '@sigx/runtime-core', version: '0.7.0' });
        pkg(join(dir, 'node_modules/@sigx/lynx-cli'), { name: '@sigx/lynx-cli', version: '0.32.0', dependencies: { '@sigx/cli': '^0.12.0' } });
        pkg(join(dir, 'node_modules/@sigx/terminal'), { name: '@sigx/terminal', version: '0.13.0', peerDependencies: { '@sigx/runtime-core': '^1.0.0' } });
        pkg(join(dir, 'node_modules/@sigx/runtime-terminal'), { name: '@sigx/runtime-terminal', version: '0.13.0', peerDependencies: { '@sigx/runtime-core': '^1.0.0' } });

        const issues = checkCoreCompat(dir);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ pkg: '@sigx/runtime-core', installed: '0.7.0', required: '^1.0.0' });
        const msg = formatCompatIssues(issues);
        expect(msg).toContain('npx sigx upgrade');
        expect(msg).toContain('@sigx/runtime-core@"^1.0.0"');
    });

    it('accepts a nested, satisfying copy (npm installs one under the consumer)', () => {
        pkg(join(dir, 'node_modules/@sigx/runtime-core'), { name: '@sigx/runtime-core', version: '0.7.0' });
        pkg(join(dir, 'node_modules/@sigx/lynx-runtime'), { name: '@sigx/lynx-runtime', version: '0.32.0', dependencies: { '@sigx/runtime-core': '^1.0.0' } });
        pkg(join(dir, 'node_modules/@sigx/lynx-runtime/node_modules/@sigx/runtime-core'), { name: '@sigx/runtime-core', version: '1.0.1' });
        expect(checkCoreCompat(dir)).toEqual([]);
    });

    it('skips workspace/catalog ranges (monorepo examples)', () => {
        pkg(join(dir, 'node_modules/@sigx/runtime-core'), { name: '@sigx/runtime-core', version: '0.1.0' });
        pkg(join(dir, 'node_modules/@sigx/lynx-runtime'), { name: '@sigx/lynx-runtime', version: '0.32.0', dependencies: { '@sigx/runtime-core': 'catalog:' } });
        expect(checkCoreCompat(dir)).toEqual([]);
    });

    it('flags an older sigx host but not a newer one', () => {
        pkg(join(dir, 'node_modules/@sigx/lynx-cli'), { name: '@sigx/lynx-cli', version: '0.32.0', dependencies: { '@sigx/cli': '^0.12.0' } });
        expect(checkHostCompat(dir, '0.5.1')).toMatchObject({ pkg: '@sigx/cli', installed: '0.5.1', required: '^0.12.0' });
        expect(checkHostCompat(dir, '0.12.1')).toBeNull();
        expect(checkHostCompat(dir, '0.13.0')).toBeNull();
        expect(checkHostCompat(dir, undefined)).toBeNull();
    });
});

describe('upgrade companions', () => {
    it('moves core + host ranges in step, leaving absent and workspace entries alone', () => {
        const source = JSON.stringify({
            dependencies: { '@sigx/runtime-core': '^0.7.0', '@sigx/reactivity': 'workspace:^' },
            devDependencies: { '@sigx/cli': '^0.5.0' },
        }, null, 4) + '\n';
        const { text, changes } = rewriteCompanionDeps(source, {
            '@sigx/runtime-core': '^1.0.0',
            '@sigx/reactivity': '^1.0.0',
            '@sigx/cli': '^0.12.0',
        });
        expect(changes.map((c) => `${c.name}:${c.from}->${c.to}`)).toEqual([
            '@sigx/runtime-core:^0.7.0->^1.0.0',
            '@sigx/cli:^0.5.0->^0.12.0',
        ]);
        const out = JSON.parse(text);
        expect(out.dependencies['@sigx/reactivity']).toBe('workspace:^');
        expect(text.endsWith('\n')).toBe(true);
        expect(text).toContain('\n    "dependencies"');
    });

    it('never loosens a range that already satisfies the target', () => {
        const source = JSON.stringify({ devDependencies: { '@sigx/cli': '^0.12.1', '@lynx-js/rspeedy': '>=0.1.0' } });
        const { changes } = rewriteCompanionDeps(source, { '@sigx/cli': '^0.12.0', '@lynx-js/rspeedy': '>=0.16.3' });
        expect(changes.map((c) => c.name)).toEqual(['@lynx-js/rspeedy']);
    });

    it('treats the @sigx/lynx umbrella as part of the lockstep family', () => {
        expect(isSigxLynxName('@sigx/lynx')).toBe(true);
        expect(isSigxLynxName('@sigx/lynx-cli')).toBe(true);
        expect(isSigxLynxName('@sigx/lynxish')).toBe(false);
        expect(isSigxLynxName('@sigx/runtime-core')).toBe(false);
    });

    it('returns the source untouched when nothing changes', () => {
        const source = '{\n  "dependencies": { "@sigx/runtime-core": "^1.0.0" }\n}\n';
        expect(rewriteCompanionDeps(source, { '@sigx/runtime-core': '^1.0.0' })).toEqual({ text: source, changes: [] });
    });
});

describe('doctor classification', () => {
    it('requires Node 22+', () => {
        expect(checkNode('v22.22.0').status).toBe('ok');
        expect(checkNode('v24.1.0').status).toBe('ok');
        expect(checkNode('v20.11.0')).toMatchObject({ status: 'error' });
        expect(checkNode('v18.19.0').detail).toContain('nodejs.org');
    });

    it('JDK: ok / warn-with-fallback / error, mirroring the build', () => {
        const jdk = (source: 'JAVA_HOME' | 'PATH' | 'Android Studio', major: number) => ({ source, home: `/${source}`, version: `${major}.0.0`, major });
        const studio = jdk('Android Studio', 21);
        const tooNew = jdk('JAVA_HOME', 25);
        expect(classifyJdk({ chosen: studio, found: [studio] }).status).toBe('ok');
        const warn = classifyJdk({ chosen: studio, found: [tooNew, studio] });
        expect(warn.status).toBe('warn');
        expect(warn.message).toContain('JDK 25');
        expect(warn.message).toContain('JDK 21');
        const err = classifyJdk({ chosen: null, found: [tooNew] });
        expect(err.status).toBe('error');
        expect(err.detail).toContain('Android Studio');
        expect(classifyJdk({ chosen: null, found: [] }).status).toBe('warn');
    });
});

describe('Android SDK defaults', () => {
    it('knows Android Studio\'s default SDK location on each OS', () => {
        expect(defaultAndroidSdkRoots('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me')[0])
            .toMatch(/AppData[\\/]Local[\\/]Android[\\/]Sdk$/);
        expect(defaultAndroidSdkRoots('darwin', {}, '/Users/me')[0]).toMatch(/Library[\\/]Android[\\/]sdk$/);
        expect(defaultAndroidSdkRoots('linux', {}, '/home/me')[0]).toMatch(/Android[\\/]Sdk$/);
    });
});
