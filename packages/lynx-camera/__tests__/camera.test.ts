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

// Only the bridge is faked: `unwrapNative` and `SigxError` come from the real
// core, so the C4 assertions below exercise the shipped unwrap rather than a
// stand-in that could pass with the fix reverted.
vi.mock('@sigx/lynx-core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@sigx/lynx-core')>()),
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    isModuleAvailable: (...args: unknown[]) =>
        bridge.isModuleAvailable(...(args as [])),
}));

const { Camera } = await import('../src/camera.js');
const { SigxError } = await import('@sigx/lynx-core');

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

    it('normalizes the bare iOS path to a file:// URI', async () => {
        bridge.callAsync.mockResolvedValueOnce({ uri: '/var/mobile/tmp/camera_x.jpg', width: 1, height: 1 });
        const result = await Camera.takePicture();
        expect(result.uri).toBe('file:///var/mobile/tmp/camera_x.jpg');
    });

    it('normalizes Android\'s cancel sentinel to the documented shape', async () => {
        // Android marks user-cancel as `{ cancelled: true, error: "cancelled" }`.
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true, error: 'cancelled' });
        const result = await Camera.takePicture();
        expect(result).toEqual({ cancelled: true });
    });

    it('leaves the iOS cancel shape (no uri) untouched', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true });
        const result = await Camera.takePicture();
        expect(result).toEqual({ cancelled: true });
    });

    it('treats re-entrant pre-emption as cancel, not failure', async () => {
        // MediaCapture pre-empts a pending call with a "cancelled by new …" error.
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true, error: 'cancelled by new takePicture' });
        const result = await Camera.takePicture();
        expect(result).toEqual({ cancelled: true });
    });

    it('treats Activity teardown ("activity destroyed") as cancel, not failure', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true, error: 'activity destroyed' });
        const result = await Camera.takePicture();
        expect(result).toEqual({ cancelled: true });
    });

    it('throws a SigxError on a native failure error (C4/C10)', async () => {
        const raw = { error: 'Camera not available on this device' };
        bridge.callAsync.mockResolvedValueOnce(raw);
        // Native failures arrive on the *resolved* callback, so without the
        // unwrap the caller reads `undefined` off a "successful" result.
        const err = await Camera.takePicture().then(
            (r) => { throw new Error(`expected a throw, resolved ${JSON.stringify(r)}`); },
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(SigxError);
        const sigx = err as InstanceType<typeof SigxError>;
        expect(sigx.code).toBe('native_error');
        expect(sigx.package).toBe('lynx-camera');
        expect(sigx.message).toBe(
            '[@sigx/lynx-camera] takePicture failed: Camera not available on this device',
        );
        expect(sigx.cause).toBe(raw);
    });

    it('throws on a non-string error payload instead of reporting a cancel', async () => {
        // The bespoke unwrap only recognized `typeof error === 'string'`, so a
        // structured error resolved as `{ cancelled: true }`.
        bridge.callAsync.mockResolvedValueOnce({ error: { code: 7, message: 'busy' } });
        await expect(Camera.takePicture()).rejects.toThrow(
            '[@sigx/lynx-camera] takePicture failed: {"code":7,"message":"busy"}',
        );
    });

    it('throws when a failure arrives alongside Android\'s cancelled flag', async () => {
        // MediaCapture sets `cancelled: true` on genuine failures too, so the
        // flag can never be the cancel signal — only the sentinel strings are.
        bridge.callAsync.mockResolvedValueOnce({
            error: "FileProvider authority 'com.acme.fileprovider' not configured: missing <provider>",
            cancelled: true,
        });
        await expect(Camera.takePicture()).rejects.toThrow(
            "[@sigx/lynx-camera] takePicture failed: FileProvider authority 'com.acme.fileprovider' not configured: missing <provider>",
        );
    });

    it('throws on a payload that is not the documented object', async () => {
        // The bridge shape varies by path (#342); a JSON string used to settle
        // as a cancel, hiding the capture entirely.
        bridge.callAsync.mockResolvedValueOnce('{"uri":"/tmp/a.jpg"}');
        await expect(Camera.takePicture()).rejects.toThrow(
            '[@sigx/lynx-camera] takePicture failed: unexpected native payload: "{\\"uri\\":\\"/tmp/a.jpg\\"}"',
        );
    });

    it('throws when the callback resolves nothing at all', async () => {
        bridge.callAsync.mockResolvedValueOnce(undefined);
        await expect(Camera.takePicture()).rejects.toBeInstanceOf(SigxError);
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
        // Narrow the cancel arm out (CameraCancelled has no uri) before reading
        // clip-only fields.
        if (!result.uri) throw new Error('expected a clip');
        expect(result.durationMs).toBe(4200);
        expect(result.width).toBe(1920);
    });

    it('passes Android content:// URIs through untouched', async () => {
        bridge.callAsync.mockResolvedValueOnce({ uri: 'content://media/external/video/1' });
        const result = await Camera.recordVideo();
        expect(result.uri).toBe('content://media/external/video/1');
    });

    it('normalizes Android\'s cancel sentinel to the documented shape', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true, error: 'cancelled' });
        const result = await Camera.recordVideo();
        expect(result).toEqual({ cancelled: true });
    });

    it('leaves the iOS cancel shape (no uri) untouched without throwing', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true });
        const result = await Camera.recordVideo();
        expect(result).toEqual({ cancelled: true });
    });

    it('throws a SigxError naming recordVideo on a native failure error (C4/C10)', async () => {
        bridge.callAsync.mockResolvedValueOnce({ error: 'Camera permission denied' });
        const err = await Camera.recordVideo().then(
            (r) => { throw new Error(`expected a throw, resolved ${JSON.stringify(r)}`); },
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(SigxError);
        expect((err as InstanceType<typeof SigxError>).code).toBe('native_error');
        // The action, not the module name — a caller reading the log has to be
        // able to tell a failed capture from a failed recording.
        expect((err as Error).message).toBe(
            '[@sigx/lynx-camera] recordVideo failed: Camera permission denied',
        );
    });

    it('throws on a payload that is not the documented object', async () => {
        bridge.callAsync.mockResolvedValueOnce(['content://media/external/video/1']);
        await expect(Camera.recordVideo()).rejects.toThrow(
            '[@sigx/lynx-camera] recordVideo failed: unexpected native payload:',
        );
    });
});

describe('Camera.isAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(Camera.isAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('Camera');
    });
});
