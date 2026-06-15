import { describe, it, expect, vi } from 'vitest';
import { StaticManifestProvider, validateUpdatesManifest } from '../src/provider/static-manifest';
import type { UpdateCheckContext } from '../src/types';

const MANIFEST_URL = 'https://cdn.example.com/myapp/production/manifest.json';

const ctx = (overrides: Partial<UpdateCheckContext> = {}): UpdateCheckContext => ({
    platform: 'android',
    runtimeVersion: 'fp1-aaaa',
    currentUpdateId: null,
    embeddedVersion: '1.0.0',
    channel: 'production',
    ...overrides,
});

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function entry(overrides: Record<string, unknown> = {}) {
    return {
        version: '1.1.0',
        runtimeVersion: 'fp1-aaaa',
        bundleUrl: 'updates/aaa/main.lynx.bundle',
        sha256: SHA_A,
        createdAt: '2026-06-01T00:00:00Z',
        ...overrides,
    };
}

function providerFor(doc: unknown) {
    const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => doc,
    })) as unknown as typeof globalThis.fetch;
    return { provider: new StaticManifestProvider({ url: MANIFEST_URL, fetchImpl }), fetchImpl };
}

describe('validateUpdatesManifest', () => {
    it('accepts a well-formed document', () => {
        expect(validateUpdatesManifest({ schemaVersion: 1, updates: [entry()] })).toEqual([]);
    });

    it('rejects wrong schemaVersion, missing fields and bad hashes', () => {
        expect(validateUpdatesManifest({ schemaVersion: 2, updates: [] })).not.toEqual([]);
        expect(validateUpdatesManifest({ schemaVersion: 1 })).not.toEqual([]);
        expect(validateUpdatesManifest({
            schemaVersion: 1,
            updates: [entry({ sha256: 'nothex' })],
        })).not.toEqual([]);
        expect(validateUpdatesManifest({
            schemaVersion: 1,
            updates: [entry({ bundleUrl: '' })],
        })).not.toEqual([]);
    });
});

describe('StaticManifestProvider selection', () => {
    it('returns update-available for a matching entry and resolves relative bundleUrl', async () => {
        const { provider } = providerFor({ schemaVersion: 1, updates: [entry()] });
        const result = await provider.checkForUpdate(ctx());
        expect(result.type).toBe('update-available');
        if (result.type !== 'update-available') return;
        expect(result.manifest.bundleUrl).toBe('https://cdn.example.com/myapp/production/updates/aaa/main.lynx.bundle');
        // default id = sha256 prefix
        expect(result.manifest.id).toBe(SHA_A.slice(0, 16));
    });

    it('filters by platform, channel and runtimeVersion', async () => {
        const { provider } = providerFor({
            schemaVersion: 1,
            updates: [
                entry({ platforms: ['ios'] }),
                entry({ channel: 'beta', sha256: SHA_B }),
            ],
        });
        const result = await provider.checkForUpdate(ctx());
        expect(result.type).toBe('up-to-date');
    });

    it('picks the newest entry by createdAt', async () => {
        const { provider } = providerFor({
            schemaVersion: 1,
            updates: [
                entry({ version: '1.1.0', createdAt: '2026-06-01T00:00:00Z' }),
                entry({ version: '1.2.0', sha256: SHA_B, createdAt: '2026-06-10T00:00:00Z' }),
            ],
        });
        const result = await provider.checkForUpdate(ctx());
        expect(result.type).toBe('update-available');
        if (result.type !== 'update-available') return;
        expect(result.manifest.version).toBe('1.2.0');
    });

    it('returns up-to-date when the best entry is what we are running', async () => {
        const { provider } = providerFor({ schemaVersion: 1, updates: [entry()] });
        const result = await provider.checkForUpdate(ctx({ currentUpdateId: SHA_A.slice(0, 16) }));
        expect(result.type).toBe('up-to-date');
    });

    it('surfaces a runtimeVersion mismatch as incompatible (needs new prebuild)', async () => {
        const { provider } = providerFor({
            schemaVersion: 1,
            updates: [entry({ runtimeVersion: 'fp1-NEWER' })],
        });
        const result = await provider.checkForUpdate(ctx());
        expect(result.type).toBe('incompatible');
        if (result.type !== 'incompatible') return;
        expect(result.manifest.runtimeVersion).toBe('fp1-NEWER');
    });

    it('throws check-failed on malformed manifests', async () => {
        const { provider } = providerFor({ schemaVersion: 1, updates: [{ nope: true }] });
        await expect(provider.checkForUpdate(ctx())).rejects.toMatchObject({ code: 'check-failed' });
    });

    it('rejects malformed optional fields as check-failed, not a TypeError', async () => {
        for (const bad of [
            entry({ platforms: 123 }),
            entry({ platforms: ['windows'] }),
            entry({ channel: 42 }),
            entry({ mandatory: 'yes' }),
        ]) {
            const { provider } = providerFor({ schemaVersion: 1, updates: [bad] });
            await expect(provider.checkForUpdate(ctx())).rejects.toMatchObject({ code: 'check-failed' });
        }
    });

    it('throws check-failed on HTTP errors', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: false,
            status: 404,
            json: async () => ({}),
        })) as unknown as typeof globalThis.fetch;
        const provider = new StaticManifestProvider({ url: MANIFEST_URL, fetchImpl });
        await expect(provider.checkForUpdate(ctx())).rejects.toMatchObject({ code: 'check-failed' });
    });
});

describe('StaticManifestProvider runtime-resolved endpoint + auth hooks', () => {
    function spyFetch(doc: unknown) {
        return vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => doc,
        })) as unknown as ReturnType<typeof vi.fn> & typeof globalThis.fetch;
    }

    it('resolves the manifest URL from a function and uses it for relative bundleUrl resolution', async () => {
        const fetchImpl = spyFetch({ schemaVersion: 1, updates: [entry()] });
        const url = vi.fn((c: UpdateCheckContext) =>
            `https://${c.platform}.host.example.com/${c.channel}/manifest.json`);
        const provider = new StaticManifestProvider({ url, fetchImpl });

        const result = await provider.checkForUpdate(ctx());
        expect(url).toHaveBeenCalledWith(expect.objectContaining({ platform: 'android', channel: 'production' }));
        expect(fetchImpl).toHaveBeenCalledWith('https://android.host.example.com/production/manifest.json', expect.anything());
        expect(result.type).toBe('update-available');
        if (result.type !== 'update-available') return;
        // Relative bundleUrl resolves against the RESOLVED manifest URL.
        expect(result.manifest.bundleUrl).toBe('https://android.host.example.com/production/updates/aaa/main.lynx.bundle');
    });

    it('applies endpoint headers from a { url, headers } resolver to the manifest fetch', async () => {
        const fetchImpl = spyFetch({ schemaVersion: 1, updates: [entry()] });
        const provider = new StaticManifestProvider({
            url: () => ({ url: MANIFEST_URL, headers: { 'X-Env': 'staging' } }),
            fetchImpl,
        });
        await provider.checkForUpdate(ctx());
        expect(fetchImpl).toHaveBeenCalledWith(MANIFEST_URL, { headers: { 'X-Env': 'staging' } });
    });

    it('merges onBeforeCheck headers over static headers for the manifest fetch', async () => {
        const fetchImpl = spyFetch({ schemaVersion: 1, updates: [entry()] });
        const onBeforeCheck = vi.fn(async () => ({ Authorization: 'Bearer fresh-token' }));
        const provider = new StaticManifestProvider({
            url: MANIFEST_URL,
            headers: { Accept: 'application/json', Authorization: 'Bearer stale' },
            onBeforeCheck,
            fetchImpl,
        });
        await provider.checkForUpdate(ctx());
        expect(onBeforeCheck).toHaveBeenCalledWith(expect.objectContaining({ platform: 'android' }));
        expect(fetchImpl).toHaveBeenCalledWith(MANIFEST_URL, {
            headers: { Accept: 'application/json', Authorization: 'Bearer fresh-token' },
        });
    });

    it('surfaces a throwing onBeforeCheck as check-failed', async () => {
        const fetchImpl = spyFetch({ schemaVersion: 1, updates: [entry()] });
        const provider = new StaticManifestProvider({
            url: MANIFEST_URL,
            onBeforeCheck: async () => { throw new Error('token refresh failed'); },
            fetchImpl,
        });
        await expect(provider.checkForUpdate(ctx())).rejects.toMatchObject({ code: 'check-failed' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('merges onBeforeDownload headers over static headers in resolveDownload', async () => {
        const onBeforeDownload = vi.fn(async () => ({ Authorization: 'Bearer dl-token' }));
        const provider = new StaticManifestProvider({
            url: MANIFEST_URL,
            headers: { 'X-Client': 'lynx' },
            onBeforeDownload,
        });
        const manifest = {
            id: 'abc', version: '1.0.0', runtimeVersion: 'fp1-aaaa',
            bundleUrl: 'https://cdn.example.com/b.bundle', sha256: SHA_A, mandatory: false,
        };
        const spec = await provider.resolveDownload(manifest, ctx());
        expect(onBeforeDownload).toHaveBeenCalledWith(manifest, expect.objectContaining({ platform: 'android' }));
        expect(spec).toEqual({
            url: 'https://cdn.example.com/b.bundle',
            sha256: SHA_A,
            headers: { 'X-Client': 'lynx', Authorization: 'Bearer dl-token' },
        });
    });

    it('back-compat: a static url + headers still apply to both requests, undefined when unset', async () => {
        const fetchImpl = spyFetch({ schemaVersion: 1, updates: [entry()] });
        const provider = new StaticManifestProvider({ url: MANIFEST_URL, fetchImpl });
        await provider.checkForUpdate(ctx());
        // No headers configured → fetch called with headers: undefined.
        expect(fetchImpl).toHaveBeenCalledWith(MANIFEST_URL, { headers: undefined });
        const spec = await provider.resolveDownload(
            { id: 'x', version: '1', runtimeVersion: 'fp1-aaaa', bundleUrl: 'u', sha256: SHA_A, mandatory: false },
            ctx(),
        );
        expect(spec.headers).toBeUndefined();
    });
});
