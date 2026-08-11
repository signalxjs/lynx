/**
 * Unit tests for the JS-side FilePicker API. Mocks `@sigx/lynx-core` so we
 * never hit a real native module. The real UIDocumentPicker / SAF round-trip
 * is exercised on-device via examples/showcase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    isModuleAvailable: vi.fn(() => true),
};

// Only the bridge is faked — `unwrapNative` and `SigxError` are the real ones,
// so the failure assertions below check the error callers actually get.
vi.mock('@sigx/lynx-core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@sigx/lynx-core')>()),
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    isModuleAvailable: (...args: unknown[]) =>
        bridge.isModuleAvailable(...(args as [])),
}));

const { FilePicker } = await import('../src/file-picker.js');

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.isModuleAvailable.mockReset();
    bridge.isModuleAvailable.mockReturnValue(true);
});

describe('FilePicker.pick — options mapping', () => {
    it('defaults to single pick, no type filter, copyToCache on', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true });
        await FilePicker.pick();
        expect(bridge.callAsync).toHaveBeenCalledWith('FilePicker', 'pick', {
            multiple: false,
            types: [],
            copyToCache: true,
        });
    });

    it('forwards multiple/types/copyToCache', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true });
        await FilePicker.pick({
            multiple: true,
            types: ['application/pdf', 'image/*'],
            copyToCache: false,
        });
        expect(bridge.callAsync).toHaveBeenCalledWith('FilePicker', 'pick', {
            multiple: true,
            types: ['application/pdf', 'image/*'],
            copyToCache: false,
        });
    });

    it('drops empty/non-string entries from types', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true });
        await FilePicker.pick({ types: ['application/pdf', '', 42 as unknown as string] });
        expect(bridge.callAsync).toHaveBeenCalledWith('FilePicker', 'pick', {
            multiple: false,
            types: ['application/pdf'],
            copyToCache: true,
        });
    });
});

describe('FilePicker.pick — result normalization', () => {
    it('normalizes bare iOS paths to file:// URIs', async () => {
        bridge.callAsync.mockResolvedValueOnce({
            cancelled: false,
            assets: [{ uri: '/var/mobile/tmp/pick_x.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 1234 }],
        });
        const result = await FilePicker.pick();
        expect(result.assets[0].uri).toBe('file:///var/mobile/tmp/pick_x.pdf');
    });

    it('passes content:// and file:// URIs through untouched', async () => {
        bridge.callAsync.mockResolvedValueOnce({
            cancelled: false,
            assets: [
                { uri: 'content://provider/doc/1', name: 'a.txt', mimeType: 'text/plain', size: 1 },
                { uri: 'file:///data/picked/b.txt', name: 'b.txt', mimeType: 'text/plain', size: 2 },
            ],
        });
        const result = await FilePicker.pick();
        expect(result.assets.map((a) => a.uri)).toEqual([
            'content://provider/doc/1',
            'file:///data/picked/b.txt',
        ]);
    });

    it('accepts the single-l "canceled" spelling from native', async () => {
        bridge.callAsync.mockResolvedValueOnce({ canceled: true });
        const result = await FilePicker.pick();
        expect(result.cancelled).toBe(true);
    });

    it('defaults assets to an empty array on cancel', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true });
        const result = await FilePicker.pick();
        expect(result.assets).toEqual([]);
    });

    it('guarantees name/mimeType/size with sensible fallbacks', async () => {
        bridge.callAsync.mockResolvedValueOnce({
            cancelled: false,
            assets: [{ uri: 'content://provider/doc/My%20Report.pdf' }],
        });
        const result = await FilePicker.pick();
        expect(result.assets[0]).toEqual({
            uri: 'content://provider/doc/My%20Report.pdf',
            name: 'My Report.pdf',
            mimeType: 'application/octet-stream',
            size: 0,
        });
    });

    it('drops assets without a uri', async () => {
        bridge.callAsync.mockResolvedValueOnce({
            cancelled: false,
            assets: [{ name: 'ghost.txt' }, { uri: 'file:///real.txt', name: 'real.txt', mimeType: 'text/plain', size: 3 }],
        });
        const result = await FilePicker.pick();
        expect(result.assets).toHaveLength(1);
        expect(result.assets[0].name).toBe('real.txt');
    });

    it('coerces negative/non-finite sizes to 0', async () => {
        bridge.callAsync.mockResolvedValueOnce({
            cancelled: false,
            assets: [{ uri: 'file:///x', name: 'x', mimeType: 'text/plain', size: -5 }],
        });
        const result = await FilePicker.pick();
        expect(result.assets[0].size).toBe(0);
    });
});

describe('FilePicker.pick — native failures (C4/C10)', () => {
    /** Resolve with whatever `p` rejected with. */
    const rejection = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

    // Both platforms resolve `{ cancelled: true, assets: [], error }` on a real
    // failure, so a picker that never opened used to look exactly like a user
    // tapping Cancel — with the actionable native message thrown away.
    it.each([
        [
            'android: the SAF launcher was never registered',
            'MediaCapture not registered — @sigx/lynx-permissions normally wires this automatically via PermissionsActivityHook at Activity onCreate; ensure the package is installed and autolinked',
        ],
        ['android: the intent could not be launched', 'launcher.launch failed'],
        ['ios: nothing could present the picker', 'no presenter available'],
    ])('throws when %s', async (_case, nativeError) => {
        const { isSigxError } = await import('@sigx/lynx-core');
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true, assets: [], error: nativeError });

        const error = await rejection(FilePicker.pick());

        if (!isSigxError(error)) throw new Error('expected a SigxError');
        expect(error.code).toBe('native_error');
        expect(error.package).toBe('lynx-file-picker');
        expect(error.message).toBe(`[@sigx/lynx-file-picker] pick failed: ${nativeError}`);
        // The raw payload rides along for diagnostics.
        expect(error.cause).toMatchObject({ error: nativeError });
    });

    it('throws even when the payload also carries assets', async () => {
        // `cancelled`/`assets` must not mask the error — the presence of the
        // envelope is what decides.
        bridge.callAsync.mockResolvedValueOnce({
            cancelled: false,
            assets: [{ uri: 'file:///half.txt' }],
            error: 'read failed',
        });
        await expect(FilePicker.pick()).rejects.toThrow(
            '[@sigx/lynx-file-picker] pick failed: read failed',
        );
    });

    it.each([
        ['a bare string', 'file:///picked.txt'],
        ['an array', [{ uri: 'file:///picked.txt' }]],
        ['null', null],
        ['a number', 7],
        ['an object of none of the documented keys', { ok: true }],
    ])('throws on %s, rather than reporting a pick of zero files', async (_case, payload) => {
        // `unwrapNative` only recognizes `{ error }`, so without a shape guard
        // each of these normalizes to `{ cancelled: false, assets: [] }` — a
        // successful pick that returned nothing, which a caller cannot tell
        // from a genuinely empty one. The bridge's payload shape varies by
        // path (#342), so this is a live case.
        bridge.callAsync.mockResolvedValueOnce(payload);
        await expect(FilePicker.pick()).rejects.toThrow(
            /pick failed: unexpected native payload/,
        );
    });
});

describe('FilePicker.pick — a dismissal is not a failure (C5)', () => {
    it('resolves cancelled when the user dismisses the picker', async () => {
        // Neither platform sets `error` for a plain user cancel: iOS
        // documentPickerWasCancelled, Android SAF with no URI.
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true, assets: [] });
        await expect(FilePicker.pick()).resolves.toEqual({ cancelled: true, assets: [] });
    });

    it.each([
        ['a newer pick pre-empted this one (single)', 'cancelled by new pickFile'],
        ['a newer pick pre-empted this one (multi)', 'cancelled by new pickFiles'],
        ['the Activity was torn down mid-pick', 'activity destroyed'],
    ])('resolves cancelled when %s', async (_case, nativeError) => {
        // Android tags these with an `error`; iOS signals the same pre-emption
        // with a bare `{ cancelled: true }`. Throwing here would make the most
        // ordinary path — picking twice in a row — platform-dependent.
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true, assets: [], error: nativeError });
        await expect(FilePicker.pick()).resolves.toEqual({ cancelled: true, assets: [] });
    });
});

describe('FilePicker.isAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(FilePicker.isAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('FilePicker');
    });
});
