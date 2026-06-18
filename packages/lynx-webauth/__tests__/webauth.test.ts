/**
 * Unit tests for the JS-side WebAuth bridge. Mocks `@sigx/lynx-core` so we
 * never hit a real native module; the real ASWebAuthenticationSession /
 * Custom Tabs round-trip is exercised on-device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
}));

const { openAuthSession, isWebAuthAvailable } = await import('../src/webauth.js');

beforeEach(() => {
    bridge.callAsync.mockReset();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.isModuleAvailable.mockReset();
    bridge.isModuleAvailable.mockReturnValue(true);
});

function lastOpenCall(): unknown[] {
    const call = bridge.callAsync.mock.calls.find((c) => c[1] === 'openAuthSession');
    if (!call) throw new Error('openAuthSession was not called');
    return call;
}

describe('openAuthSession', () => {
    it('forwards the authorize URL + options to native and returns { url } on success', async () => {
        bridge.callAsync.mockResolvedValueOnce({ url: 'myapp://cb?code=abc123&state=s' });
        const result = await openAuthSession('https://idp.test/authorize?x=1', 'myapp', {
            ephemeral: true,
            toolbarColor: '#0088ff',
            preferredBrowserPackage: 'com.android.chrome',
        });
        expect(result).toEqual({ url: 'myapp://cb?code=abc123&state=s' });
        const call = lastOpenCall();
        expect(call[0]).toBe('WebAuth');
        expect(call[2]).toMatchObject({
            authorizeUrl: 'https://idp.test/authorize?x=1',
            callbackScheme: 'myapp',
            ephemeral: true,
            toolbarColor: '#0088ff',
            preferredBrowserPackage: 'com.android.chrome',
        });
        expect(typeof (call[2] as { sessionId: unknown }).sessionId).toBe('string');
    });

    it('normalizes a scheme passed with :// or trailing :', async () => {
        bridge.callAsync.mockResolvedValueOnce({ url: 'myapp://cb' });
        await openAuthSession('https://idp.test/authorize', 'myapp://');
        expect((lastOpenCall()[2] as { callbackScheme: string }).callbackScheme).toBe('myapp');

        bridge.callAsync.mockResolvedValueOnce({ url: 'myapp://cb' });
        await openAuthSession('https://idp.test/authorize', 'myapp:');
        expect((lastOpenCall()[2] as { callbackScheme: string }).callbackScheme).toBe('myapp');

        // Forgiving: a full redirect URI reduces to the bare scheme.
        bridge.callAsync.mockResolvedValueOnce({ url: 'myapp://cb' });
        await openAuthSession('https://idp.test/authorize', 'myapp://cb');
        expect((lastOpenCall()[2] as { callbackScheme: string }).callbackScheme).toBe('myapp');
    });

    it('passes through a { canceled: true } result', async () => {
        bridge.callAsync.mockResolvedValueOnce({ canceled: true });
        await expect(openAuthSession('https://idp.test/authorize', 'myapp')).resolves.toEqual({
            canceled: true,
        });
    });

    it('passes through an { error } result', async () => {
        bridge.callAsync.mockResolvedValueOnce({ error: 'boom' });
        await expect(openAuthSession('https://idp.test/authorize', 'myapp')).resolves.toEqual({
            error: 'boom',
        });
    });

    it('resolves to { error } without calling native when args are missing', async () => {
        await expect(openAuthSession('', 'myapp')).resolves.toEqual({
            error: 'authorizeUrl is required',
        });
        await expect(openAuthSession('https://idp.test/authorize', '')).resolves.toEqual({
            error: 'callbackScheme is required',
        });
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });

    it('resolves to { error } when the module is not registered', async () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        const result = await openAuthSession('https://idp.test/authorize', 'myapp');
        expect(result).toEqual({ error: 'WebAuth module not available in this build' });
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });

    it('maps a bridge rejection to { error } (never rejects)', async () => {
        bridge.callAsync.mockRejectedValueOnce(new Error('bridge died'));
        await expect(openAuthSession('https://idp.test/authorize', 'myapp')).resolves.toEqual({
            error: 'bridge died',
        });
    });

    it('normalizes a malformed native payload to { error }', async () => {
        bridge.callAsync.mockResolvedValueOnce({ nonsense: 1 });
        const result = await openAuthSession('https://idp.test/authorize', 'myapp');
        expect(result).toEqual({ error: 'Malformed result from WebAuth native module' });
    });
});

describe('openAuthSession — AbortSignal', () => {
    it('resolves to { canceled: true } immediately if already aborted', async () => {
        const result = await openAuthSession('https://idp.test/authorize', 'myapp', {
            signal: AbortSignal.abort(),
        });
        expect(result).toEqual({ canceled: true });
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });

    it('calls cancelAuthSession with the session id when aborted mid-flight', async () => {
        let resolveOpen: ((v: unknown) => void) | undefined;
        bridge.callAsync.mockImplementation((...args: unknown[]) => {
            const method = args[1];
            if (method === 'openAuthSession') {
                return new Promise((res) => {
                    resolveOpen = res;
                });
            }
            if (method === 'cancelAuthSession') {
                // Native completes the pending session as canceled.
                resolveOpen?.({ canceled: true });
                return Promise.resolve(undefined);
            }
            return Promise.resolve(undefined);
        });

        const controller = new AbortController();
        const promise = openAuthSession('https://idp.test/authorize', 'myapp', {
            signal: controller.signal,
        });
        controller.abort();

        await expect(promise).resolves.toEqual({ canceled: true });
        const openCall = lastOpenCall();
        const cancelCall = bridge.callAsync.mock.calls.find((c) => c[1] === 'cancelAuthSession');
        const sessionId = (openCall[2] as { sessionId: string }).sessionId;
        expect(cancelCall?.[2]).toEqual({ sessionId });
    });
});

describe('isWebAuthAvailable', () => {
    it('reflects the bridge', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(true);
        expect(isWebAuthAvailable()).toBe(true);
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(isWebAuthAvailable()).toBe(false);
    });
});
