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

vi.mock('@sigx/lynx-core', () => ({
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

describe('FilePicker.isAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(FilePicker.isAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('FilePicker');
    });
});
