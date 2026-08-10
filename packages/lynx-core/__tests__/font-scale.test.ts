/**
 * OS font-scale reads (`readGlobalFontScale` / `useFontScale` /
 * `useFontScaleMT`). Module-level signal + lazy wiring — every test gets a
 * fresh module via vi.resetModules() + dynamic import, mirroring
 * app-state.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface MockEmitter {
    listeners: Map<string, Set<(...a: unknown[]) => void>>;
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
    emit: (name: string, payload: unknown) => void;
}

function makeEmitter(): MockEmitter {
    const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
    return {
        listeners,
        addListener(name, fn) {
            let set = listeners.get(name);
            if (!set) { set = new Set(); listeners.set(name, set); }
            set.add(fn);
        },
        removeListener(name, fn) {
            listeners.get(name)?.delete(fn);
        },
        // Deliberately does NOT catch — native dispatch walks one listener
        // list per channel, so an escaping exception starves the rest.
        emit(name, payload) {
            const set = listeners.get(name);
            if (!set) return;
            for (const fn of set) fn(payload);
        },
    };
}

function installMockLynx(fontScale: unknown, emitter?: MockEmitter): void {
    (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: fontScale === undefined ? {} : { fontScale },
        getJSModule: (name: string) =>
            name === 'GlobalEventEmitter' ? emitter : undefined,
    };
}

type FontScaleApi = typeof import('../src/font-scale.js');

async function freshApi(): Promise<FontScaleApi> {
    vi.resetModules();
    return await import('../src/font-scale.js');
}

beforeEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

afterEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

describe('readGlobalFontScale', () => {
    it('returns null when lynx is undefined', async () => {
        const api = await freshApi();
        expect(api.readGlobalFontScale()).toBeNull();
    });

    it('returns null when __globalProps lacks fontScale', async () => {
        const api = await freshApi();
        (globalThis as { lynx?: unknown }).lynx = { __globalProps: {} };
        expect(api.readGlobalFontScale()).toBeNull();
    });

    it('parses { scale, os }', async () => {
        const api = await freshApi();
        installMockLynx({ scale: 1.5, os: 2.0 });
        expect(api.readGlobalFontScale()).toEqual({ scale: 1.5, os: 2.0 });
    });

    it('falls back os to scale when os is missing or bogus', async () => {
        const api = await freshApi();
        installMockLynx({ scale: 1.3 });
        expect(api.readGlobalFontScale()).toEqual({ scale: 1.3, os: 1.3 });
        installMockLynx({ scale: 1.3, os: 'huge' });
        expect(api.readGlobalFontScale()).toEqual({ scale: 1.3, os: 1.3 });
    });

    it('returns null for bogus scale values', async () => {
        const api = await freshApi();
        for (const scale of [0, -1, NaN, Infinity, 'big', null]) {
            installMockLynx({ scale });
            expect(api.readGlobalFontScale()).toBeNull();
        }
    });
});

describe('useFontScaleMT', () => {
    it('returns 1 when unwired and the published scale otherwise', async () => {
        const api = await freshApi();
        expect(api.useFontScaleMT()).toBe(1);
        installMockLynx({ scale: 1.15, os: 1.15 });
        expect(api.useFontScaleMT()).toBe(1.15);
    });
});

describe('useFontScale', () => {
    it('seeds from __globalProps and updates on onFontScaleChanged', async () => {
        const emitter = makeEmitter();
        installMockLynx({ scale: 1.3, os: 1.3 }, emitter);
        const api = await freshApi();

        const scale = api.useFontScale();
        expect(scale.value).toBe(1.3);

        emitter.emit(api.FONT_SCALE_EVENT, { scale: 1.6 });
        expect(scale.value).toBe(1.6);
    });

    it('defaults to 1 when the publisher is unwired', async () => {
        const api = await freshApi();
        expect(api.useFontScale().value).toBe(1);
    });

    it('returns a stable computed across calls', async () => {
        installMockLynx({ scale: 1.2, os: 1.2 }, makeEmitter());
        const api = await freshApi();
        expect(api.useFontScale()).toBe(api.useFontScale());
    });

    it('accepts a bare-number payload and ignores bogus payloads', async () => {
        const emitter = makeEmitter();
        installMockLynx({ scale: 1, os: 1 }, emitter);
        const api = await freshApi();
        const scale = api.useFontScale();

        emitter.emit(api.FONT_SCALE_EVENT, 1.4);
        expect(scale.value).toBe(1.4);

        for (const bogus of [{ scale: 0 }, { scale: -2 }, { scale: NaN }, 'wat', null, {}]) {
            emitter.emit(api.FONT_SCALE_EVENT, bogus);
        }
        expect(scale.value).toBe(1.4);
    });

    it('rounds Float-widening noise to 3 decimals (seed and event)', async () => {
        const emitter = makeEmitter();
        installMockLynx({ scale: 1.1499999761581421, os: 1.15 }, emitter);
        const api = await freshApi();
        const scale = api.useFontScale();
        expect(scale.value).toBe(1.15);

        emitter.emit(api.FONT_SCALE_EVENT, { scale: 1.2999999523162842 });
        expect(scale.value).toBe(1.3);
    });

    it('wires late: a first call off-host retries on the next call', async () => {
        const api = await freshApi();
        const scale = api.useFontScale();   // no lynx global yet
        expect(scale.value).toBe(1);

        const emitter = makeEmitter();
        installMockLynx({ scale: 1.3, os: 1.3 }, emitter);
        api.useFontScale();                 // retries seed + wiring
        expect(scale.value).toBe(1.3);
        emitter.emit(api.FONT_SCALE_EVENT, { scale: 1.5 });
        expect(scale.value).toBe(1.5);
    });

    it('accepts a payload delivered as a JSON string', async () => {
        const emitter = makeEmitter();
        installMockLynx({ scale: 1, os: 1 }, emitter);
        const api = await freshApi();
        const scale = api.useFontScale();

        emitter.emit(api.FONT_SCALE_EVENT, JSON.stringify({ scale: 1.4 }));
        expect(scale.value).toBe(1.4);

        emitter.emit(api.FONT_SCALE_EVENT, '1.6');
        expect(scale.value).toBe(1.6);
    });

    it('contains a throwing reactive consumer instead of letting it escape into native dispatch', async () => {
        const emitter = makeEmitter();
        installMockLynx({ scale: 1, os: 1 }, emitter);
        const api = await freshApi();
        const scale = api.useFontScale();

        // Imported AFTER freshApi()'s resetModules so this is the same
        // reactivity instance the fresh font-scale module tracks against.
        const { effect } = await import('@sigx/reactivity');
        effect(() => {
            if (scale.value !== 1) throw new Error('render bug');
        });

        // Another package's listener on the engine's channel, after ours.
        const sibling: unknown[] = [];
        emitter.addListener(api.FONT_SCALE_EVENT, (p) => { sibling.push(p); });

        expect(() => emitter.emit(api.FONT_SCALE_EVENT, { scale: 1.5 })).not.toThrow();
        expect(sibling).toEqual([{ scale: 1.5 }]);
    });

    it('registers exactly one native listener however often the hook is called', async () => {
        const emitter = makeEmitter();
        installMockLynx({ scale: 1.2, os: 1.2 }, emitter);
        const api = await freshApi();
        api.useFontScale();
        api.useFontScale();
        api.useFontScale();

        expect(emitter.listeners.get(api.FONT_SCALE_EVENT)?.size).toBe(1);
    });
});
