/**
 * Unit tests for the JS-side SecureStorage API. Mocks `@sigx/lynx-core`
 * so we never hit a real Keychain/Keystore. Real round-trip is exercised
 * on-device via examples/showcase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => ({ ok: true }) as unknown),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    isModuleAvailable: (...args: unknown[]) =>
        bridge.isModuleAvailable(...(args as [])),
}));

const { SecureStorage } = await import('../src/secure-storage.js');

beforeEach(() => {
    bridge.callAsync.mockReset();
    bridge.callAsync.mockResolvedValue({ ok: true });
    bridge.isModuleAvailable.mockReset();
    bridge.isModuleAvailable.mockReturnValue(true);
});

describe('SecureStorage.set', () => {
    it('forwards key, value, and opts to the native bridge', async () => {
        await SecureStorage.set('token', 'abc', { requireBiometric: true });
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'SecureStorage',
            'set',
            'token',
            'abc',
            { requireBiometric: true },
        );
    });

    it('defaults opts to an empty object', async () => {
        await SecureStorage.set('token', 'abc');
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'SecureStorage',
            'set',
            'token',
            'abc',
            {},
        );
    });

    it('throws when native returns { error }', async () => {
        bridge.callAsync.mockResolvedValueOnce({ error: 'keychain locked' });
        await expect(SecureStorage.set('token', 'abc')).rejects.toThrow(/keychain locked/);
    });

    it('throws on empty key', async () => {
        await expect(SecureStorage.set('', 'abc')).rejects.toThrow(/non-empty string/);
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });
});

describe('SecureStorage.get', () => {
    it('forwards key + opts and returns the value', async () => {
        bridge.callAsync.mockResolvedValueOnce({ value: 'abc' });
        const value = await SecureStorage.get('token', {
            biometricPrompt: { reason: 'Unlock', title: 'Acme' },
        });
        expect(value).toBe('abc');
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'SecureStorage',
            'get',
            'token',
            { biometricPrompt: { reason: 'Unlock', title: 'Acme' } },
        );
    });

    it('returns null when native returns no value', async () => {
        bridge.callAsync.mockResolvedValueOnce({ value: null });
        expect(await SecureStorage.get('missing')).toBeNull();
    });

    it('returns null when native omits value entirely', async () => {
        bridge.callAsync.mockResolvedValueOnce({});
        expect(await SecureStorage.get('missing')).toBeNull();
    });

    it('throws on native error (e.g. biometric cancel)', async () => {
        bridge.callAsync.mockResolvedValueOnce({ error: 'userCancel' });
        await expect(SecureStorage.get('token')).rejects.toThrow(/userCancel/);
    });
});

describe('SecureStorage.delete', () => {
    it('forwards the key', async () => {
        await SecureStorage.delete('token');
        expect(bridge.callAsync).toHaveBeenCalledWith('SecureStorage', 'delete', 'token');
    });
});

describe('SecureStorage.clear', () => {
    it('calls native with no arguments', async () => {
        await SecureStorage.clear();
        expect(bridge.callAsync).toHaveBeenCalledWith('SecureStorage', 'clear');
    });
});

describe('SecureStorage.hasKey', () => {
    it('returns the exists flag from native', async () => {
        bridge.callAsync.mockResolvedValueOnce({ exists: true });
        expect(await SecureStorage.hasKey('token')).toBe(true);
        bridge.callAsync.mockResolvedValueOnce({ exists: false });
        expect(await SecureStorage.hasKey('token')).toBe(false);
    });

    it('returns false (without calling native) on empty key', async () => {
        expect(await SecureStorage.hasKey('')).toBe(false);
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });
});

describe('SecureStorage.isAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(SecureStorage.isAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('SecureStorage');
    });
});
