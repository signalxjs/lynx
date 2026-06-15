import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publishUpdate } from '../src/index';

const tempDirs: string[] = [];

function makeProject(opts: { bundle?: string; sidecar?: object } = {}): string {
    const cwd = mkdtempSync(join(tmpdir(), 'sigx-publish-'));
    tempDirs.push(cwd);
    if (opts.bundle !== undefined) {
        mkdirSync(join(cwd, 'dist'), { recursive: true });
        writeFileSync(join(cwd, 'dist', 'main.lynx.bundle'), opts.bundle);
    }
    if (opts.sidecar !== undefined) {
        mkdirSync(join(cwd, '.sigx'), { recursive: true });
        writeFileSync(join(cwd, '.sigx', 'runtime-versions.json'), JSON.stringify(opts.sidecar));
    }
    return cwd;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('publishUpdate', () => {
    it('writes the static-hosting layout and returns structured metadata', async () => {
        const bundleContent = 'fake lynx bundle bytes';
        const sha256 = createHash('sha256').update(bundleContent).digest('hex');
        const updateId = sha256.slice(0, 16);
        const cwd = makeProject({
            bundle: bundleContent,
            sidecar: { android: 'fp1-androidaaaa', ios: 'fp1-iosbbbb' },
        });

        const result = await publishUpdate({ cwd, appVersion: '1.4.2', notes: 'First OTA' });

        // Structured result — what CI consumes instead of scraping stdout.
        expect(result.updateId).toBe(updateId);
        expect(result.sha256).toBe(sha256);
        expect(result.bundleUrl).toBe(`updates/${updateId}/main.lynx.bundle`);
        expect(result.manifestPath).toBe(join(cwd, 'updates-dist', 'production', 'manifest.json'));
        expect(result.channel).toBe('production');
        expect(result.appVersion).toBe('1.4.2');
        expect(result.sizeBytes).toBe(Buffer.byteLength(bundleContent));
        expect(result.mandatory).toBe(false);
        expect(result.runtimeVersions).toEqual([
            { platform: 'android', runtimeVersion: 'fp1-androidaaaa' },
            { platform: 'ios', runtimeVersion: 'fp1-iosbbbb' },
        ]);

        const channelDir = join(cwd, 'updates-dist', 'production');
        expect(existsSync(join(channelDir, 'updates', updateId, 'main.lynx.bundle'))).toBe(true);

        const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
        expect(manifest.schemaVersion).toBe(1);
        expect(manifest.updates).toHaveLength(2);
        const android = manifest.updates.find((e: any) => e.platforms[0] === 'android');
        const ios = manifest.updates.find((e: any) => e.platforms[0] === 'ios');
        expect(android.runtimeVersion).toBe('fp1-androidaaaa');
        expect(ios.runtimeVersion).toBe('fp1-iosbbbb');
        for (const entry of [android, ios]) {
            expect(entry.id).toBe(updateId);
            expect(entry.version).toBe('1.4.2');
            expect(entry.sha256).toBe(sha256);
            expect(entry.bundleUrl).toBe(`updates/${updateId}/main.lynx.bundle`);
            expect(entry.mandatory).toBe(false);
            expect(entry.metadata.releaseNotes).toBe('First OTA');
        }
    });

    it('replaces prior entries for the same runtimeVersion but keeps other runtimes (the compat story)', async () => {
        const cwd = makeProject({ bundle: 'bundle v1', sidecar: { android: 'fp1-old' } });
        await publishUpdate({ cwd });

        // Native changed → new fingerprint; old binaries must keep their entry.
        writeFileSync(join(cwd, 'dist', 'main.lynx.bundle'), 'bundle v2');
        writeFileSync(join(cwd, '.sigx', 'runtime-versions.json'), JSON.stringify({ android: 'fp1-new' }));
        await publishUpdate({ cwd });

        // Republish for the new runtime — replaces only the fp1-new entry.
        writeFileSync(join(cwd, 'dist', 'main.lynx.bundle'), 'bundle v3');
        const result = await publishUpdate({ cwd });

        const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
        const runtimes = manifest.updates.map((e: any) => e.runtimeVersion).sort();
        expect(runtimes).toEqual(['fp1-new', 'fp1-old']);
        const newEntry = manifest.updates.find((e: any) => e.runtimeVersion === 'fp1-new');
        const v3Sha = createHash('sha256').update('bundle v3').digest('hex');
        expect(newEntry.sha256).toBe(v3Sha);
        // Content-addressed bundle dirs accumulate (old clients still download v2).
        const v2Sha = createHash('sha256').update('bundle v2').digest('hex');
        expect(existsSync(join(cwd, 'updates-dist', 'production', 'updates', v2Sha.slice(0, 16), 'main.lynx.bundle'))).toBe(true);
    });

    it('honors the runtimeVersion override without a sidecar', async () => {
        const cwd = makeProject({ bundle: 'bundle' });
        const result = await publishUpdate({ cwd, runtimeVersion: '1.0.0', channel: 'beta', mandatory: true });

        const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
        expect(result.channel).toBe('beta');
        expect(result.mandatory).toBe(true);
        expect(manifest.updates).toHaveLength(2);
        expect(manifest.updates.every((e: any) => e.runtimeVersion === '1.0.0')).toBe(true);
        expect(manifest.updates.every((e: any) => e.mandatory === true)).toBe(true);
    });

    it('honors explicit per-platform runtimeVersions over the sidecar', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar: { android: 'fp1-sidecar', ios: 'fp1-sidecar' } });
        const result = await publishUpdate({ cwd, runtimeVersions: { ios: 'fp1-explicit-ios' } });

        expect(result.runtimeVersions).toEqual([{ platform: 'ios', runtimeVersion: 'fp1-explicit-ios' }]);
        const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
        expect(manifest.updates).toHaveLength(1);
        expect(manifest.updates[0].runtimeVersion).toBe('fp1-explicit-ios');
    });

    it('survives a partially-corrupted existing manifest (missing platforms, null/string entries)', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar: { android: 'fp1-a' } });
        // Hand-edited / corrupted manifest: a well-formed array, malformed entries.
        const channelDir = join(cwd, 'updates-dist', 'production');
        mkdirSync(channelDir, { recursive: true });
        writeFileSync(
            join(channelDir, 'manifest.json'),
            JSON.stringify({ schemaVersion: 1, updates: [{ id: 'broken', runtimeVersion: 'fp1-a' }, null, 'bad'] }),
        );

        const result = await publishUpdate({ cwd });
        const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf-8'));
        // Malformed entries are preserved (not crashed on); the new one is appended.
        expect(manifest.updates.some((e: any) => e?.id === 'broken')).toBe(true);
        expect(manifest.updates.some((e: any) => e?.platforms?.[0] === 'android' && e?.id === result.updateId)).toBe(true);
    });

    it('ignores non-string runtime-version values (malformed sidecar)', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar: { android: 123, ios: '' } });
        // Neither is a usable fingerprint → same actionable error as no sidecar.
        await expect(publishUpdate({ cwd })).rejects.toThrow(/sigx prebuild/);
    });

    it('rejects a channel with path separators / traversal (no escaping the output dir)', async () => {
        const cwd = makeProject({ bundle: 'bundle', sidecar: { android: 'fp1-a' } });
        for (const channel of ['../../etc', 'a/b', 'a\\b', '']) {
            await expect(publishUpdate({ cwd, channel })).rejects.toThrow(/channel/i);
        }
    });

    it('errors with actionable messages for missing bundle / missing sidecar / empty bundle', async () => {
        const noBundle = makeProject({ sidecar: { android: 'fp1-a' } });
        await expect(publishUpdate({ cwd: noBundle })).rejects.toThrow(/sigx build/);

        const noSidecar = makeProject({ bundle: 'bundle' });
        await expect(publishUpdate({ cwd: noSidecar })).rejects.toThrow(/sigx prebuild/);

        const emptyBundle = makeProject({ bundle: '', sidecar: { android: 'fp1-a' } });
        await expect(publishUpdate({ cwd: emptyBundle })).rejects.toThrow(/empty/i);
    });
});
