/**
 * Unit tests for the JS-side Camera API. Mocks `@sigx/lynx-core` so we never
 * hit a real native module. The real UIImagePickerController / ACTION_*_CAPTURE
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

const { Camera } = await import('../src/camera.js');

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.isModuleAvailable.mockReset();
    bridge.isModuleAvailable.mockReturnValue(true);
});

describe('Camera.takePicture', () => {
    it('forwards options to the native module', async () => {
        bridge.callAsync.mockResolvedValueOnce({ uri: '/tmp/a.jpg', width: 1, height: 1 });
        await Camera.takePicture({ facing: 'front', quality: 0.5 });
        expect(bridge.callAsync).toHaveBeenCalledWith('Camera', 'takePicture', {
            facing: 'front',
            quality: 0.5,
        });
    });
});

describe('Camera.recordVideo — options mapping', () => {
    it('defaults to an empty options object', async () => {
        bridge.callAsync.mockResolvedValueOnce({ uri: '/tmp/v.mov' });
        await Camera.recordVideo();
        expect(bridge.callAsync).toHaveBeenCalledWith('Camera', 'recordVideo', {});
    });

    it('forwards facing and maxDurationMs', async () => {
        bridge.callAsync.mockResolvedValueOnce({ uri: '/tmp/v.mov' });
        await Camera.recordVideo({ facing: 'back', maxDurationMs: 30_000 });
        expect(bridge.callAsync).toHaveBeenCalledWith('Camera', 'recordVideo', {
            facing: 'back',
            maxDurationMs: 30_000,
        });
    });
});

describe('Camera.recordVideo — result normalization', () => {
    it('normalizes bare iOS paths to file:// URIs', async () => {
        bridge.callAsync.mockResolvedValueOnce({
            uri: '/var/mobile/tmp/camera_x.mov',
            durationMs: 4200,
            width: 1920,
            height: 1080,
            fileSize: 9999,
        });
        const result = await Camera.recordVideo();
        expect(result.uri).toBe('file:///var/mobile/tmp/camera_x.mov');
        expect(result.durationMs).toBe(4200);
        expect(result.width).toBe(1920);
    });

    it('passes Android content:// URIs through untouched', async () => {
        bridge.callAsync.mockResolvedValueOnce({ uri: 'content://media/external/video/1' });
        const result = await Camera.recordVideo();
        expect(result.uri).toBe('content://media/external/video/1');
    });

    it('leaves the cancel shape (no uri) untouched without throwing', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true });
        const result = await Camera.recordVideo();
        expect(result).toEqual({ cancelled: true });
    });
});

describe('Camera.isAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(Camera.isAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('Camera');
    });
});
