import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runUpdatesPublish, BUILD_MARKER_FILE } from '../src/updates-publish';
import { envHash } from '../src/config/env';

const silent = { log: () => {}, error: () => {} };
const tempDirs: string[] = [];

/** `.sigx-build.json` as `@sigx/lynx-plugin` writes it after a build. */
function writeMarker(dir: string, marker: { variant?: string; env?: object } = {}): void {
    writeFileSync(join(dir, BUILD_MARKER_FILE), JSON.stringify({
        variant: marker.variant ?? '',
        envHash: envHash(marker.env ?? {}),
        channel: 'production',
        builtAt: new Date(0).toISOString(),
    }));
}

function makeProject(opts: {
    bundle?: string;
    sidecar?: object;
    /** Build marker next to the bundle; `null` = none. Default: a base build. */
    marker?: { variant?: string; env?: object } | null;
    /** `signalx.config.mjs` default export. */
    config?: object;
} = {}): string {
    const cwd = mkdtempSync(join(tmpdir(), 'sigx-publish-'));
    tempDirs.push(cwd);
    if (opts.bundle !== undefined) {
        mkdirSync(join(cwd, 'dist'), { recursive: true });
        writeFileSync(join(cwd, 'dist', 'main.lynx.bundle'), opts.bundle);
        if (opts.marker !== null) writeMarker(join(cwd, 'dist'), opts.marker);
    }
    if (opts.config !== undefined) {
        writeFileSync(join(cwd, 'signalx.config.mjs'), `export default ${JSON.stringify(opts.config)};\n`);
    }
    if (opts.sidecar !== undefined) {
        mkdirSync(join(cwd, '.sigx'), { recursive: true });
        writeFileSync(join(cwd, '.sigx', 'runtime-versions.json'), JSON.stringify(opts.sidecar));
    }
    return cwd;
}

afterEach(() => {
    for (const key of ['SIGX_LYNX_ENV', 'SIGX_LYNX_VARIANT', 'SIGX_LYNX_LOGGING', 'SIGX_LYNX_UPDATES_CHANNEL']) {
        delete process.env[key];
    }
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('updates:publish', () => {
    it('writes the static-hosting layout with per-platform manifest entries', async () => {
        const bundleContent = 'fake lynx bundle bytes';
        const sha256 = createHash('sha256').update(bundleContent).digest('hex');
        const updateId = sha256.slice(0, 16);
        const cwd = makeProject({
            bundle: bundleContent,
            sidecar: { android: 'fp1-androidaaaa', ios: 'fp1-iosbbbb' },
        });

        await runUpdatesPublish({ cwd, logger: silent, notes: 'First OTA' });

        const channelDir = join(cwd, 'updates-dist', 'production');
        expect(existsSync(join(channelDir, 'updates', updateId, 'main.lynx.bundle'))).toBe(true);

        const manifest = JSON.parse(readFileSync(join(channelDir, 'manifest.json'), 'utf-8'));
        expect(manifest.schemaVersion).toBe(1);
        expect(manifest.updates).toHaveLength(2);
        const android = manifest.updates.find((e: any) => e.platforms[0] === 'android');
        const ios = manifest.updates.find((e: any) => e.platforms[0] === 'ios');
        expect(android.runtimeVersion).toBe('fp1-androidaaaa');
        expect(ios.runtimeVersion).toBe('fp1-iosbbbb');
        for (const entry of [android, ios]) {
            expect(entry.id).toBe(updateId);
            expect(entry.sha256).toBe(sha256);
            expect(entry.bundleUrl).toBe(`updates/${updateId}/main.lynx.bundle`);
            expect(entry.mandatory).toBe(false);
            expect(entry.metadata.releaseNotes).toBe('First OTA');
        }
    });

    it('replaces prior entries for the same runtimeVersion but keeps other runtimes (the compat story)', async () => {
        const cwd = makeProject({
            bundle: 'bundle v1',
            sidecar: { android: 'fp1-old' },
        });
        await runUpdatesPublish({ cwd, logger: silent });

        // Native changed → new fingerprint; old binaries must keep their entry.
        writeFileSync(join(cwd, 'dist', 'main.lynx.bundle'), 'bundle v2');
        writeFileSync(join(cwd, '.sigx', 'runtime-versions.json'), JSON.stringify({ android: 'fp1-new' }));
        await runUpdatesPublish({ cwd, logger: silent });

        // Republish for the new runtime — replaces only the fp1-new entry.
        writeFileSync(join(cwd, 'dist', 'main.lynx.bundle'), 'bundle v3');
        await runUpdatesPublish({ cwd, logger: silent });

        const manifest = JSON.parse(readFileSync(
            join(cwd, 'updates-dist', 'production', 'manifest.json'), 'utf-8'));
        const runtimes = manifest.updates.map((e: any) => e.runtimeVersion).sort();
        expect(runtimes).toEqual(['fp1-new', 'fp1-old']);
        const newEntry = manifest.updates.find((e: any) => e.runtimeVersion === 'fp1-new');
        const v3Sha = createHash('sha256').update('bundle v3').digest('hex');
        expect(newEntry.sha256).toBe(v3Sha);
        // Content-addressed bundle dirs accumulate (old clients still download v2).
        const v2Sha = createHash('sha256').update('bundle v2').digest('hex');
        expect(existsSync(join(cwd, 'updates-dist', 'production', 'updates', v2Sha.slice(0, 16), 'main.lynx.bundle'))).toBe(true);
    });

    it('honors --runtime-version override without a sidecar', async () => {
        const cwd = makeProject({ bundle: 'bundle' });
        await runUpdatesPublish({ cwd, logger: silent, runtimeVersion: '1.0.0', channel: 'beta', mandatory: true });

        const manifest = JSON.parse(readFileSync(
            join(cwd, 'updates-dist', 'beta', 'manifest.json'), 'utf-8'));
        expect(manifest.updates).toHaveLength(2);
        expect(manifest.updates.every((e: any) => e.runtimeVersion === '1.0.0')).toBe(true);
        expect(manifest.updates.every((e: any) => e.mandatory === true)).toBe(true);
    });

    it('errors with actionable messages for missing bundle / missing sidecar', async () => {
        const noBundle = makeProject({ sidecar: { android: 'fp1-a' } });
        await expect(runUpdatesPublish({ cwd: noBundle, logger: silent }))
            .rejects.toThrow(/sigx build/);

        const noSidecar = makeProject({ bundle: 'bundle' });
        await expect(runUpdatesPublish({ cwd: noSidecar, logger: silent }))
            .rejects.toThrow(/sigx prebuild/);

        const emptyBundle = makeProject({ bundle: '', sidecar: { android: 'fp1-a' } });
        await expect(runUpdatesPublish({ cwd: emptyBundle, logger: silent }))
            .rejects.toThrow(/empty/i);
    });

    it('refuses to publish when dist/ contains async chunks (#599)', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar: { android: 'fp1-a' } });
        const asyncDir = join(cwd, 'dist', 'static', 'js', 'async');
        mkdirSync(asyncDir, { recursive: true });
        writeFileSync(join(asyncDir, '101.abc.js'), 'chunk');

        await expect(runUpdatesPublish({ cwd, logger: silent }))
            .rejects.toThrow(/--allow-async-chunks/);

        // Escape hatch for remotely-hosted chunks.
        const result = await runUpdatesPublish({ cwd, logger: silent, allowAsyncChunks: true });
        expect(result.updateId).toBeTruthy();
    });

    it('scopes the async-chunk check to the published bundle, not cwd/dist (#599)', async () => {
        // A CI artifact bundle outside dist/, while dist/ holds stale chunks
        // from some unrelated earlier build.
        const cwd = makeProject({ bundle: 'stale', sidecar: { android: 'fp1-a' } });
        const staleChunks = join(cwd, 'dist', 'static', 'js', 'async');
        mkdirSync(staleChunks, { recursive: true });
        writeFileSync(join(staleChunks, 'stale.js'), 'stale');

        const artifactDir = join(cwd, 'artifacts');
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, 'main.lynx.bundle'), 'ci artifact bundle');
        writeMarker(artifactDir);

        // Stale dist/ chunks must not block publishing this bundle.
        const ok = await runUpdatesPublish({
            cwd, logger: silent, bundle: 'artifacts/main.lynx.bundle',
        });
        expect(ok.updateId).toBeTruthy();

        // ...but chunks sitting next to THAT bundle must still be caught.
        const artifactChunks = join(artifactDir, 'static', 'js', 'async');
        mkdirSync(artifactChunks, { recursive: true });
        writeFileSync(join(artifactChunks, '101.abc.js'), 'chunk');
        await expect(runUpdatesPublish({
            cwd, logger: silent, bundle: 'artifacts/main.lynx.bundle',
        })).rejects.toThrow(/--allow-async-chunks/);
    });
});

describe('updates:publish — build check (#1244)', () => {
    const config = {
        name: 'demo',
        version: '2.0.0',
        env: { api: 'https://api.example.com' },
        variants: {
            staging: { env: { api: 'https://staging.example.com' }, updates: { defaultChannel: 'staging' } },
        },
    };
    const stagingEnv = { api: 'https://staging.example.com' };
    const sidecar = { android: 'fp1-a' };

    function logger() {
        const warnings: string[] = [];
        return { warnings, log: () => {}, error: () => {}, warn: (m: string) => { warnings.push(m); } };
    }

    it('refuses a bundle with no build marker unless --skip-build-check', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar, marker: null });
        await expect(runUpdatesPublish({ cwd, logger: silent }))
            .rejects.toThrow(/\.sigx-build\.json not found.*--skip-build-check/);
        const result = await runUpdatesPublish({ cwd, logger: silent, skipBuildCheck: true });
        expect(result.updateId).toBeTruthy();
    });

    it('refuses a staging-built bundle published as the base build', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar, config, marker: { variant: 'staging', env: stagingEnv } });
        await expect(runUpdatesPublish({ cwd, logger: silent }))
            .rejects.toThrow(/built for variant 'staging'.*--variant staging/);
    });

    it('refuses a base-built bundle published as a variant', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar, config, marker: { env: config.env } });
        await expect(runUpdatesPublish({ cwd, logger: silent, variant: 'staging' }))
            .rejects.toThrow(/built for the base \(production\) config.*sigx build --variant staging/);
    });

    it('publishes a matching variant build to the variant\'s channel, without warnings', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar, config, marker: { variant: 'staging', env: stagingEnv } });
        const log = logger();
        const result = await runUpdatesPublish({ cwd, logger: log, variant: 'staging' });
        expect(result.channel).toBe('staging');
        expect(result.appVersion).toBe('2.0.0');
        expect(log.warnings).toEqual([]);
    });

    it('warns (but publishes) when the baked env differs from the resolved config', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar, config, marker: { variant: 'staging', env: { api: 'stale' } } });
        const log = logger();
        const result = await runUpdatesPublish({ cwd, logger: log, variant: 'staging' });
        expect(result.updateId).toBeTruthy();
        expect(log.warnings).toHaveLength(1);
        expect(log.warnings[0]).toMatch(/app env baked into this bundle differs/);
    });

    it('rejects --variant without a signalx.config', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar, marker: { variant: 'staging' } });
        await expect(runUpdatesPublish({ cwd, logger: silent, variant: 'staging' }))
            .rejects.toThrow(/needs a signalx\.config\.ts/);
    });
});
