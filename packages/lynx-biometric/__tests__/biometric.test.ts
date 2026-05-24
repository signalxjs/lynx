/**
 * Unit tests for the JS-side biometric API. Mocks `@sigx/lynx-core` so we
 * never hit a real native module. Real LAContext / BiometricPrompt
 * round-trip is exercised on-device via examples/showcase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    isModuleAvailable: (...args: unknown[]) =>
        bridge.isModuleAvailable(...(args as [])),
}));

const { Biometric } = await import('../src/biometric.js');

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.isModuleAvailable.mockReset();
    bridge.isModuleAvailable.mockReturnValue(true);
});

describe('Biometric.isAvailable', () => {
    it('forwards to the native bridge and returns its result', async () => {
        bridge.callAsync.mockResolvedValueOnce({ available: true, type: 'faceId' });
        const result = await Biometric.isAvailable();
        expect(result).toEqual({ available: true, type: 'faceId' });
        expect(bridge.callAsync).toHaveBeenCalledWith('Biometric', 'isAvailable');
    });

    it('resolves to { available: false, type: "none" } when module is not registered', async () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        const result = await Biometric.isAvailable();
        expect(result).toEqual({ available: false, type: 'none' });
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });
});

describe('Biometric.authenticate', () => {
    it('forwards opts to the native bridge unchanged', async () => {
        bridge.callAsync.mockResolvedValueOnce({ success: true });
        const opts = {
            reason: 'Unlock vault',
            title: 'Authenticate',
            fallbackTitle: 'Use Passcode',
            allowDeviceCredential: true,
        };
        const result = await Biometric.authenticate(opts);
        expect(result).toEqual({ success: true });
        expect(bridge.callAsync).toHaveBeenCalledWith('Biometric', 'authenticate', opts);
    });

    it('passes through error payloads from native', async () => {
        bridge.callAsync.mockResolvedValueOnce({
            success: false,
            error: 'User cancelled',
            errorCode: 'userCancel',
        });
        const result = await Biometric.authenticate({ reason: 'Unlock' });
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('userCancel');
    });

    it('rejects empty reason without hitting native', async () => {
        const result = await Biometric.authenticate({ reason: '' });
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('unknown');
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });

    it('returns biometryNotAvailable when module is not registered', async () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        const result = await Biometric.authenticate({ reason: 'Unlock' });
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('biometryNotAvailable');
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });
});

describe('Biometric.isModuleAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(Biometric.isModuleAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('Biometric');
    });
});
