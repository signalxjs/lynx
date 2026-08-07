/**
 * `runPrebuild`'s fast path vs. `--embed-bundle` (#960).
 *
 * `embedBundle` had thorough unit tests and was correct. The bug was that on a
 * JS-only change `runPrebuild` returned from its fingerprint fast path *before
 * calling it*, so `run:{android,ios} --release` packaged whatever bundle the
 * native project happened to be holding — a previous one, or none.
 *
 * That gap survived precisely because every test stopped at the unit boundary,
 * so these drive `runPrebuild` itself. They exercise only the fast path (the
 * first thing it does), which keeps them cheap: a fast-path run returns without
 * touching the scaffolding pipeline.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    runPrebuild,
    fingerprintPrebuildInputs,
    androidPrebuildSentinels,
    iosPrebuildSentinels,
} from '../src/prebuild.js';
import { writeCachedFingerprint } from '../src/util/build-fingerprint.js';
import { embeddedBundleDest } from '../src/util/embed-bundle.js';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

const TEST_CONFIG: LynxConfig = {
    name: 'TestApp',
    version: '1.0.0',
    modules: [],
    platforms: ['android', 'ios'],
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};
const config = resolveConfig(TEST_CONFIG);

const tempDirs: string[] = [];

/**
 * `runPrebuild` logs through a module-level `console.log`, so capture that
 * rather than widen its options purely for the test.
 */
let logs: string[];
beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '));
    });
});

/**
 * A project whose fast path is primed to fire: config on disk, the sentinel
 * outputs present, and the cached fingerprint matching current inputs.
 */
function makePrimedProject(bundleContents: string): string {
    const cwd = mkdtempSync(join(tmpdir(), 'sigx-fastpath-'));
    tempDirs.push(cwd);

    // `.mjs` so loadConfig can import it directly — no esbuild TS transform.
    writeFileSync(
        join(cwd, 'signalx.config.mjs'),
        `export default ${JSON.stringify(TEST_CONFIG, null, 2)};\n`,
    );

    mkdirSync(join(cwd, 'dist'), { recursive: true });
    writeFileSync(join(cwd, 'dist', 'main.lynx.bundle'), bundleContents);

    // Touch every sentinel so `outputsIntact` holds.
    for (const p of [...androidPrebuildSentinels(cwd), ...iosPrebuildSentinels(cwd)]) {
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, '');
    }
    return cwd;
}

function primeFingerprint(cwd: string, platforms: { android: boolean; ios: boolean }): void {
    writeCachedFingerprint(cwd, 'prebuild-inputs', fingerprintPrebuildInputs(cwd, platforms));
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runPrebuild fast path + embedBundle', () => {
    it('still embeds the bundle when the pipeline is skipped', async () => {
        const cwd = makePrimedProject('BUNDLE_V1');
        primeFingerprint(cwd, { android: true, ios: false });

        await runPrebuild({ cwd, android: true, ios: false, embedBundle: true });

        // The fast path must genuinely have fired — otherwise this test would
        // be passing for the wrong reason (a full prebuild also embeds).
        expect(logs.join('\n')).toMatch(/inputs unchanged/);
        expect(readFileSync(embeddedBundleDest(cwd, config, 'android'), 'utf8')).toBe('BUNDLE_V1');
    });

    it('re-embeds after a JS-only change — the reported regression', async () => {
        const cwd = makePrimedProject('BUNDLE_V1');
        primeFingerprint(cwd, { android: true, ios: false });
        await runPrebuild({ cwd, android: true, ios: false, embedBundle: true });

        // Edit JS and rebuild. Native inputs are untouched, so the fingerprint
        // is unchanged and the fast path fires again — which is the whole trap.
        writeFileSync(join(cwd, 'dist', 'main.lynx.bundle'), 'BUNDLE_V2');

        await runPrebuild({ cwd, android: true, ios: false, embedBundle: true });
        expect(logs.join('\n')).toMatch(/inputs unchanged/);
        expect(readFileSync(embeddedBundleDest(cwd, config, 'android'), 'utf8')).toBe('BUNDLE_V2');
    });

    it('embeds on iOS too', async () => {
        const cwd = makePrimedProject('BUNDLE_V1');
        primeFingerprint(cwd, { android: false, ios: true });
        await runPrebuild({ cwd, android: false, ios: true, embedBundle: true });
        expect(readFileSync(embeddedBundleDest(cwd, config, 'ios'), 'utf8')).toBe('BUNDLE_V1');
    });

    it('embeds both platforms when both are requested', async () => {
        const cwd = makePrimedProject('BUNDLE_V1');
        primeFingerprint(cwd, { android: true, ios: true });
        await runPrebuild({ cwd, android: true, ios: true, embedBundle: true });
        expect(readFileSync(embeddedBundleDest(cwd, config, 'android'), 'utf8')).toBe('BUNDLE_V1');
        expect(readFileSync(embeddedBundleDest(cwd, config, 'ios'), 'utf8')).toBe('BUNDLE_V1');
    });

    it('leaves the bundle alone when embedding was not asked for', async () => {
        // The dev path: `sigx run:android` must keep falling through to the dev
        // server, so a plain fast-path run must not bake a bundle in.
        const cwd = makePrimedProject('BUNDLE_V1');
        primeFingerprint(cwd, { android: true, ios: false });
        await runPrebuild({ cwd, android: true, ios: false });
        expect(existsSync(embeddedBundleDest(cwd, config, 'android'))).toBe(false);
    });

    it('reports the missing build output rather than skipping silently', async () => {
        const cwd = makePrimedProject('BUNDLE_V1');
        rmSync(join(cwd, 'dist', 'main.lynx.bundle'));
        primeFingerprint(cwd, { android: true, ios: false });
        await expect(
            runPrebuild({ cwd, android: true, ios: false, embedBundle: true }),
        ).rejects.toThrow(/sigx build/);
    });
});
