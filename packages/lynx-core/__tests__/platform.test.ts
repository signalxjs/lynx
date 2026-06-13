/**
 * Platform — OS detection, select() precedence, and SystemInfo-derived
 * fields. `platform.ts` snapshots SystemInfo + the `__WEB__` define at module
 * load, so each case sets the globals then re-imports a fresh module copy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Globals = Record<string, unknown>;

async function loadPlatform(systemInfo?: Record<string, unknown>, web?: boolean) {
    vi.resetModules();
    const g = globalThis as Globals;
    if (systemInfo === undefined) delete g.SystemInfo;
    else g.SystemInfo = systemInfo;
    if (web === undefined) delete g.__WEB__;
    else g.__WEB__ = web;
    return import('../src/platform.js');
}

afterEach(() => {
    const g = globalThis as Globals;
    delete g.SystemInfo;
    delete g.__WEB__;
    vi.resetModules();
});

describe('Platform.OS', () => {
    it('reads ios from SystemInfo.platform (case-insensitive)', async () => {
        const { Platform } = await loadPlatform({ platform: 'iOS' });
        expect(Platform.OS).toBe('ios');
    });

    it('reads android from SystemInfo.platform', async () => {
        const { Platform } = await loadPlatform({ platform: 'Android' });
        expect(Platform.OS).toBe('android');
    });

    it('defaults to android when SystemInfo is absent', async () => {
        const { Platform } = await loadPlatform(undefined);
        expect(Platform.OS).toBe('android');
    });

    it('is "web" when the __WEB__ build define is set, regardless of SystemInfo', async () => {
        const { Platform } = await loadPlatform({ platform: 'iOS' }, true);
        expect(Platform.OS).toBe('web');
    });
});

describe('Platform.select', () => {
    it('returns the exact OS key when present', async () => {
        const { Platform } = await loadPlatform({ platform: 'iOS' });
        expect(Platform.select({ ios: 'i', android: 'a', default: 'd' })).toBe('i');
    });

    it('falls back to `native` for ios/android when the OS key is absent', async () => {
        const { Platform } = await loadPlatform({ platform: 'Android' });
        expect(Platform.select({ native: 'n', default: 'd' })).toBe('n');
    });

    it('falls back to `default` when nothing matches', async () => {
        const { Platform } = await loadPlatform({ platform: 'Android' });
        expect(Platform.select({ ios: 'i', default: 'd' })).toBe('d');
    });

    it('web does not match `native`', async () => {
        const { Platform } = await loadPlatform({}, true);
        expect(Platform.select({ native: 'n', default: 'd' })).toBe('d');
        expect(Platform.select({ web: 'w', native: 'n', default: 'd' })).toBe('w');
    });

    it('honors an explicit undefined for the matching key (presence, not truthiness)', async () => {
        const { Platform } = await loadPlatform({ platform: 'iOS' });
        expect(Platform.select({ ios: undefined, default: 'd' })).toBeUndefined();
    });
});

describe('Platform info fields', () => {
    it('reads Version and screen/engine metrics from SystemInfo', async () => {
        const { Platform } = await loadPlatform({
            platform: 'iOS',
            osVersion: '17.4',
            pixelRatio: 3,
            pixelWidth: 1170,
            pixelHeight: 2532,
            engineVersion: '3.6.0',
            runtimeType: 'jsc',
        });
        expect(Platform.Version).toBe('17.4');
        expect(Platform.pixelRatio).toBe(3);
        expect(Platform.pixelWidth).toBe(1170);
        expect(Platform.pixelHeight).toBe(2532);
        expect(Platform.engineVersion).toBe('3.6.0');
        expect(Platform.runtimeType).toBe('jsc');
    });

    it('falls back to neutral defaults when SystemInfo is absent', async () => {
        const { Platform } = await loadPlatform(undefined);
        expect(Platform.Version).toBe('');
        expect(Platform.pixelRatio).toBe(1);
        expect(Platform.pixelWidth).toBe(0);
        expect(Platform.pixelHeight).toBe(0);
    });

    it('isPad is true for a large iOS logical screen', async () => {
        // 2048×2732 @2x → min logical edge 1024dp ≥ 600.
        const { Platform } = await loadPlatform({
            platform: 'iOS', pixelWidth: 2048, pixelHeight: 2732, pixelRatio: 2,
        });
        expect(Platform.isPad).toBe(true);
    });

    it('isPad is false for a phone-sized iOS screen', async () => {
        // 1170×2532 @3x → min logical edge 390dp < 600.
        const { Platform } = await loadPlatform({
            platform: 'iOS', pixelWidth: 1170, pixelHeight: 2532, pixelRatio: 3,
        });
        expect(Platform.isPad).toBe(false);
    });

    it('isPad is false on Android even with a tablet-sized screen', async () => {
        const { Platform } = await loadPlatform({
            platform: 'Android', pixelWidth: 2048, pixelHeight: 2732, pixelRatio: 2,
        });
        expect(Platform.isPad).toBe(false);
    });
});
