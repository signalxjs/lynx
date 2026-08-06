/**
 * Live screen metrics (`readGlobalScreen` / `useScreen` / `useScreenMT` /
 * `useOrientation`). Module-level signal + lazy wiring — every test gets a
 * fresh module via vi.resetModules() + dynamic import, mirroring
 * font-scale.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface MockEmitter {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
    emit: (name: string, payload: unknown) => void;
}

function makeEmitter(): MockEmitter {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
    return {
        addListener(name, fn) {
            let set = listeners.get(name);
            if (!set) { set = new Set(); listeners.set(name, set); }
            set.add(fn);
        },
        removeListener(name, fn) {
            listeners.get(name)?.delete(fn);
        },
        emit(name, payload) {
            for (const fn of listeners.get(name) ?? []) fn(payload);
        },
    };
}

function installMockLynx(screen: unknown, emitter?: MockEmitter): void {
    (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: screen === undefined ? {} : { screen },
        getJSModule: (name: string) =>
            name === 'GlobalEventEmitter' ? emitter : undefined,
    };
}

const PORTRAIT = { width: 400, height: 800, scale: 3, orientation: 'portrait' };
const LANDSCAPE = { width: 800, height: 400, scale: 3, orientation: 'landscape-left' };

type ScreenApi = typeof import('../src/screen.js');

async function freshApi(): Promise<ScreenApi> {
    vi.resetModules();
    return await import('../src/screen.js');
}

beforeEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

afterEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

describe('readGlobalScreen', () => {
    it('returns null when lynx is undefined', async () => {
        const api = await freshApi();
        expect(api.readGlobalScreen()).toBeNull();
    });

    it('returns null when __globalProps lacks screen', async () => {
        const api = await freshApi();
        installMockLynx(undefined);
        expect(api.readGlobalScreen()).toBeNull();
    });

    it('parses a published map and derives isLandscape', async () => {
        const api = await freshApi();
        installMockLynx(LANDSCAPE);
        expect(api.readGlobalScreen()).toEqual({
            width: 800, height: 400, scale: 3,
            orientation: 'landscape-left', isLandscape: true,
        });

        installMockLynx(PORTRAIT);
        expect(api.readGlobalScreen()).toEqual({
            width: 400, height: 800, scale: 3,
            orientation: 'portrait', isLandscape: false,
        });
    });

    it('derives the orientation from the aspect ratio when absent or unknown', async () => {
        const api = await freshApi();
        installMockLynx({ width: 800, height: 400, scale: 2 });
        expect(api.readGlobalScreen()?.orientation).toBe('landscape-left');
        installMockLynx({ width: 400, height: 800, scale: 2, orientation: 'sideways' });
        expect(api.readGlobalScreen()?.orientation).toBe('portrait');
    });

    it('defaults a missing scale to 1', async () => {
        const api = await freshApi();
        installMockLynx({ width: 400, height: 800 });
        expect(api.readGlobalScreen()?.scale).toBe(1);
    });

    it('returns null for bogus dimensions', async () => {
        const api = await freshApi();
        for (const bad of [
            { width: 0, height: 800 },
            { width: 400, height: -1 },
            { width: NaN, height: 800 },
            { width: '400', height: 800 },
            { height: 800 },
            'wat',
            null,
        ]) {
            installMockLynx(bad);
            expect(api.readGlobalScreen()).toBeNull();
        }
    });
});

describe('useScreenMT', () => {
    it('falls back to typical-phone dimensions off-host', async () => {
        const api = await freshApi();
        expect(api.useScreenMT()).toEqual({
            width: 400, height: 800, scale: 1,
            orientation: 'portrait', isLandscape: false,
        });
    });

    it('reads __globalProps directly on every call — no subscription', async () => {
        const api = await freshApi();
        installMockLynx(PORTRAIT);
        expect(api.useScreenMT().isLandscape).toBe(false);
        installMockLynx(LANDSCAPE);
        expect(api.useScreenMT().isLandscape).toBe(true);
    });
});

describe('useScreen', () => {
    it('seeds from __globalProps and updates on screenChanged', async () => {
        const emitter = makeEmitter();
        installMockLynx(PORTRAIT, emitter);
        const api = await freshApi();

        const screen = api.useScreen();
        expect(screen.value.width).toBe(400);
        expect(screen.value.isLandscape).toBe(false);

        emitter.emit(api.SCREEN_EVENT, LANDSCAPE);
        expect(screen.value.width).toBe(800);
        expect(screen.value.height).toBe(400);
        expect(screen.value.orientation).toBe('landscape-left');
        expect(screen.value.isLandscape).toBe(true);
    });

    it('returns a stable computed across calls', async () => {
        installMockLynx(PORTRAIT, makeEmitter());
        const api = await freshApi();
        expect(api.useScreen()).toBe(api.useScreen());
    });

    it('ignores bogus payloads', async () => {
        const emitter = makeEmitter();
        installMockLynx(PORTRAIT, emitter);
        const api = await freshApi();
        const screen = api.useScreen();

        for (const bogus of [{ width: 0, height: 5 }, { width: 'x' }, 'wat', null, {}]) {
            emitter.emit(api.SCREEN_EVENT, bogus);
        }
        expect(screen.value.width).toBe(400);
    });

    it('keeps the previous scale when an event omits it', async () => {
        const emitter = makeEmitter();
        installMockLynx(PORTRAIT, emitter);
        const api = await freshApi();
        const screen = api.useScreen();

        emitter.emit(api.SCREEN_EVENT, { width: 800, height: 400 });
        expect(screen.value.scale).toBe(3);
    });

    it('wires late: a first call off-host retries on the next call', async () => {
        const api = await freshApi();
        const screen = api.useScreen();      // no lynx global yet
        expect(screen.value.width).toBe(400);

        const emitter = makeEmitter();
        installMockLynx(LANDSCAPE, emitter);
        api.useScreen();                     // retries seed + wiring
        expect(screen.value.width).toBe(800);
        emitter.emit(api.SCREEN_EVENT, PORTRAIT);
        expect(screen.value.width).toBe(400);
    });
});

describe('useOrientation', () => {
    it('reports the coarse split and follows screenChanged', async () => {
        const emitter = makeEmitter();
        installMockLynx(PORTRAIT, emitter);
        const api = await freshApi();

        const orientation = api.useOrientation();
        expect(orientation.value).toBe('portrait');

        emitter.emit(api.SCREEN_EVENT, LANDSCAPE);
        expect(orientation.value).toBe('landscape');

        // Upside-down portrait is still portrait for layout purposes.
        emitter.emit(api.SCREEN_EVENT, { ...PORTRAIT, orientation: 'portrait-upside-down' });
        expect(orientation.value).toBe('portrait');
    });

    it('returns a stable computed across calls', async () => {
        installMockLynx(PORTRAIT, makeEmitter());
        const api = await freshApi();
        expect(api.useOrientation()).toBe(api.useOrientation());
    });
});
