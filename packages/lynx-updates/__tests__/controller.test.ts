/**
 * State-machine + mode-policy tests for the controller, driven through the
 * public `Updates` facade with a scripted provider and a stubbed native
 * module — the same seams the device uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Updates } from '../src/updates';
import { __resetForTests as resetController } from '../src/controller';
import { __resetForTests as resetState } from '../src/state';
import type { UpdateCheckResult, UpdateManifest, UpdateProvider } from '../src/types';

const RUNTIME = 'fp1-test';

function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
    return {
        id: 'abc123',
        version: '1.1.0',
        runtimeVersion: RUNTIME,
        bundleUrl: 'https://cdn.example.com/u/abc/main.lynx.bundle',
        sha256: 'a'.repeat(64),
        mandatory: false,
        ...overrides,
    };
}

class ScriptedProvider implements UpdateProvider {
    readonly name = 'scripted';
    result: UpdateCheckResult = { type: 'up-to-date' };
    checks = 0;
    async checkForUpdate(): Promise<UpdateCheckResult> {
        this.checks++;
        return this.result;
    }
}

interface NativeStub {
    getInstalledRuntimeVersion: () => string;
    getPlatform: () => string;
    getCurrentUpdate: (cb: (r: unknown) => void) => void;
    downloadUpdate: ReturnType<typeof vi.fn>;
    applyOnNextLaunch: ReturnType<typeof vi.fn>;
    applyNow: ReturnType<typeof vi.fn>;
    markReady: ReturnType<typeof vi.fn>;
    setRollbackOptions: ReturnType<typeof vi.fn>;
    clearUpdates: ReturnType<typeof vi.fn>;
}

function stubNative(overrides: Partial<NativeStub> = {}): NativeStub {
    const native: NativeStub = {
        getInstalledRuntimeVersion: () => RUNTIME,
        getPlatform: () => 'android',
        getCurrentUpdate: (cb) => cb({
            isEmbedded: true,
            runtimeVersion: RUNTIME,
            isFirstLaunchAfterUpdate: false,
            didRollBack: false,
        }),
        downloadUpdate: vi.fn((_params: unknown, cb: (r: unknown) => void) => cb({ ok: true })),
        applyOnNextLaunch: vi.fn((_id: unknown, cb: (r: unknown) => void) => cb({ ok: true })),
        applyNow: vi.fn((_id: unknown, cb: (r: unknown) => void) => cb({ ok: true })),
        markReady: vi.fn((cb: (r: unknown) => void) => cb({ ok: true })),
        setRollbackOptions: vi.fn((_opts: unknown, cb: (r: unknown) => void) => cb({ ok: true })),
        clearUpdates: vi.fn((cb: (r: unknown) => void) => cb({ ok: true })),
        ...overrides,
    };
    vi.stubGlobal('NativeModules', { Updates: native });
    return native;
}

/** Let the deferred bootstrap (setTimeout 0) and its awaits run. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
    resetController();
    resetState();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('configure + modes', () => {
    it('silent mode: checks on launch, downloads, stops at ready', async () => {
        const native = stubNative();
        const provider = new ScriptedProvider();
        provider.result = { type: 'update-available', manifest: manifest() };

        Updates.configure({ provider, mode: 'silent' });
        await settle();

        expect(provider.checks).toBe(1);
        expect(native.downloadUpdate).toHaveBeenCalledOnce();
        expect(native.applyOnNextLaunch).toHaveBeenCalledOnce();
        expect(native.applyNow).not.toHaveBeenCalled();
        expect(Updates.getState().status).toBe('ready');
    });

    it('immediate mode: applies as soon as the download is ready', async () => {
        const native = stubNative();
        const provider = new ScriptedProvider();
        provider.result = { type: 'update-available', manifest: manifest() };

        Updates.configure({ provider, mode: 'immediate' });
        await settle();

        expect(native.applyNow).toHaveBeenCalledOnce();
    });

    it('manual mode: does nothing automatically', async () => {
        const native = stubNative();
        const provider = new ScriptedProvider();
        provider.result = { type: 'update-available', manifest: manifest() };

        Updates.configure({ provider, mode: 'manual' });
        await settle();

        expect(provider.checks).toBe(0);
        expect(native.downloadUpdate).not.toHaveBeenCalled();
        expect(Updates.getState().status).toBe('idle');
    });

    it('mandatory updates force download + apply even in manual mode', async () => {
        const native = stubNative();
        const provider = new ScriptedProvider();
        provider.result = { type: 'update-available', manifest: manifest({ mandatory: true }) };

        Updates.configure({ provider, mode: 'manual' });
        await settle();
        // Manual mode never auto-checks…
        expect(provider.checks).toBe(0);
        // …but once the app checks, the mandatory policy takes over fully.
        await Updates.checkForUpdate();
        await settle();

        expect(Updates.getState().mandatory).toBe(true);
        expect(native.downloadUpdate).toHaveBeenCalledOnce();
        expect(native.applyNow).toHaveBeenCalledOnce();
    });

    it('clears the mandatory flag when a later check no longer returns a mandatory update', async () => {
        stubNative();
        const provider = new ScriptedProvider();
        provider.result = { type: 'update-available', manifest: manifest({ mandatory: true }) };
        Updates.configure({ provider, mode: 'manual' });
        await settle();

        await Updates.checkForUpdate();
        await settle();
        expect(Updates.getState().mandatory).toBe(true);

        provider.result = { type: 'up-to-date' };
        await Updates.checkForUpdate();
        expect(Updates.getState().mandatory).toBe(false);

        provider.result = { type: 'update-available', manifest: manifest({ id: 'other', mandatory: false }) };
        await Updates.checkForUpdate();
        expect(Updates.getState().mandatory).toBe(false);
    });

    it('rejects downloading a different update while one is in flight', async () => {
        // A download that never completes, so the first call stays in flight.
        stubNative({ downloadUpdate: vi.fn(() => { /* never calls back */ }) });
        const provider = new ScriptedProvider();
        Updates.configure({ provider, mode: 'manual' });
        await settle();

        void Updates.download(manifest({ id: 'first000' }));
        await expect(Updates.download(manifest({ id: 'second00' })))
            .rejects.toMatchObject({ code: 'download-in-progress' });
        // Joining the SAME in-flight update is allowed — it must NOT reject.
        let rejected = false;
        Updates.download(manifest({ id: 'first000' })).catch(() => { rejected = true; });
        await settle();
        expect(rejected).toBe(false);
    });

    it('honorMandatory: false leaves mandatory updates non-blocking', async () => {
        stubNative();
        const provider = new ScriptedProvider();
        provider.result = { type: 'update-available', manifest: manifest({ mandatory: true }) };

        Updates.configure({ provider, mode: 'manual', honorMandatory: false });
        await settle();
        await Updates.checkForUpdate();

        expect(Updates.getState().mandatory).toBe(false);
    });

    it('autoMarkReady (default) calls native markReady after configure', async () => {
        const native = stubNative();
        Updates.configure({ provider: new ScriptedProvider(), mode: 'manual' });
        await settle();
        expect(native.markReady).toHaveBeenCalled();
    });

    it('autoMarkReady: false defers the health signal to the app', async () => {
        const native = stubNative();
        Updates.configure({ provider: new ScriptedProvider(), mode: 'manual', autoMarkReady: false });
        await settle();
        expect(native.markReady).not.toHaveBeenCalled();
        await Updates.markReady();
        expect(native.markReady).toHaveBeenCalledOnce();
    });

    it('forwards rollback.maxFailedLaunches to native', async () => {
        const native = stubNative();
        Updates.configure({
            provider: new ScriptedProvider(),
            mode: 'manual',
            rollback: { maxFailedLaunches: 3 },
        });
        await settle();
        expect(native.setRollbackOptions).toHaveBeenCalledWith(
            { maxFailedLaunches: 3 }, expect.any(Function));
    });

    it('no-ops gracefully when the native module is absent', async () => {
        vi.stubGlobal('NativeModules', undefined);
        expect(() => Updates.configure({ provider: new ScriptedProvider() })).not.toThrow();
        await settle();
        expect(Updates.isAvailable()).toBe(false);
        expect(Updates.getState().status).toBe('idle');
    });
});

describe('runtime-version gate', () => {
    it('downgrades a provider-returned mismatching manifest to incompatible', async () => {
        stubNative();
        const provider = new ScriptedProvider();
        provider.result = {
            type: 'update-available',
            manifest: manifest({ runtimeVersion: 'fp1-NEWER' }),
        };
        Updates.configure({ provider, mode: 'manual' });
        await settle();

        const events: string[] = [];
        Updates.addListener((e) => events.push(e.type));
        const result = await Updates.checkForUpdate();

        expect(result.type).toBe('incompatible');
        expect(Updates.getState().status).toBe('incompatible');
        expect(events).toContain('incompatibleUpdate');
    });

    it('refuses to download an incompatible manifest', async () => {
        stubNative();
        Updates.configure({ provider: new ScriptedProvider(), mode: 'manual' });
        await settle();
        await expect(
            Updates.download(manifest({ runtimeVersion: 'fp1-NEWER' })),
        ).rejects.toMatchObject({ code: 'runtime-mismatch' });
    });
});

describe('error handling', () => {
    it('check failure lands in error state and is retryable', async () => {
        stubNative();
        const provider = new ScriptedProvider();
        provider.checkForUpdate = async () => { throw new Error('network down'); };
        Updates.configure({ provider, mode: 'manual' });
        await settle();

        await expect(Updates.checkForUpdate()).rejects.toMatchObject({ code: 'check-failed' });
        expect(Updates.getState().status).toBe('error');

        provider.checkForUpdate = async () => ({ type: 'up-to-date' });
        const result = await Updates.checkForUpdate();
        expect(result.type).toBe('up-to-date');
        expect(Updates.getState().status).toBe('up-to-date');
        expect(Updates.getState().error).toBe(null);
    });

    it('download failure (hash mismatch) surfaces the native code', async () => {
        stubNative({
            downloadUpdate: vi.fn((_params: unknown, cb: (r: unknown) => void) =>
                cb({ error: 'hash mismatch', code: 'hash-mismatch' })),
        });
        const provider = new ScriptedProvider();
        provider.result = { type: 'update-available', manifest: manifest() };
        Updates.configure({ provider, mode: 'manual' });
        await settle();

        await Updates.checkForUpdate();
        await expect(Updates.download()).rejects.toMatchObject({ code: 'hash-mismatch' });
        expect(Updates.getState().status).toBe('error');
    });

    it('apply without a ready download rejects', async () => {
        stubNative();
        Updates.configure({ provider: new ScriptedProvider(), mode: 'manual' });
        await settle();
        await expect(Updates.apply()).rejects.toMatchObject({ code: 'apply-failed' });
    });

    it('calls before configure() reject with not-configured', async () => {
        stubNative();
        await expect(Updates.checkForUpdate()).rejects.toMatchObject({ code: 'not-configured' });
    });
});

describe('rollback surfacing', () => {
    it('emits rolledBack with the failed update id reported by native', async () => {
        stubNative({
            getCurrentUpdate: (cb) => cb({
                isEmbedded: true,
                runtimeVersion: RUNTIME,
                isFirstLaunchAfterUpdate: false,
                didRollBack: true,
                rolledBackUpdateId: 'failed99',
            }),
        });
        const events: Array<{ type: string; fromUpdateId?: string }> = [];
        Updates.configure({ provider: new ScriptedProvider(), mode: 'manual' });
        Updates.addListener((e) => events.push(e as never));
        await settle();
        const rolledBack = events.find((e) => e.type === 'rolledBack');
        expect(rolledBack?.fromUpdateId).toBe('failed99');
        expect(Updates.getState().currentlyRunning.didRollBack).toBe(true);
        expect(Updates.getState().currentlyRunning.rolledBackUpdateId).toBe('failed99');
    });
});
