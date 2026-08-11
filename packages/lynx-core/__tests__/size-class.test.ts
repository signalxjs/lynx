/**
 * Window size classes (#1013) — `Breakpoint`, the pure bucket functions, and
 * the reactive/MT hooks derived from `useScreen()`.
 *
 * The hooks memoize into module-level singletons, so every test takes a fresh
 * module via `vi.resetModules()` + dynamic import, mirroring `screen.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effect } from '@sigx/reactivity';

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

const at = (width: number, height: number) => ({
    width, height, scale: 2,
    orientation: width > height ? 'landscape-left' : 'portrait',
});

type SizeClassApi = typeof import('../src/size-class.js');

async function freshApi(): Promise<SizeClassApi> {
    vi.resetModules();
    return await import('../src/size-class.js');
}

beforeEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

afterEach(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

describe('Breakpoint', () => {
    it('carries the Material dp thresholds', async () => {
        const api = await freshApi();
        expect(api.Breakpoint).toEqual({
            WIDTH_MEDIUM: 600,
            WIDTH_EXPANDED: 840,
            WIDTH_LARGE: 1200,
            WIDTH_XLARGE: 1600,
            HEIGHT_MEDIUM: 480,
            HEIGHT_EXPANDED: 900,
        });
    });
});

describe('widthClassOf', () => {
    // Both sides of every boundary — the bucket must be inclusive of its
    // lower bound, so 600 is 'medium' while 599 is still 'compact'.
    it.each([
        [0, 'compact'],
        [393, 'compact'],   // iPhone 15 Pro portrait
        [599, 'compact'],
        [600, 'medium'],
        [744, 'medium'],    // iPad mini portrait
        [839, 'medium'],
        [840, 'expanded'],
        [1024, 'expanded'], // iPad Air 13 portrait
        [1199, 'expanded'],
        [1200, 'large'],
        [1366, 'large'],    // iPad Air 13 landscape
        [1599, 'large'],
        [1600, 'xlarge'],
        [2560, 'xlarge'],
    ])('buckets %ddp as %s', async (width, expected) => {
        const api = await freshApi();
        expect(api.widthClassOf(width)).toBe(expected);
    });
});

describe('heightClassOf', () => {
    it.each([
        [0, 'compact'],
        [393, 'compact'],   // phone in landscape — the case width-only gets wrong
        [479, 'compact'],
        [480, 'medium'],
        [852, 'medium'],    // iPhone 15 Pro portrait
        [899, 'medium'],
        [900, 'expanded'],
        [1366, 'expanded'],
    ])('buckets %ddp as %s', async (height, expected) => {
        const api = await freshApi();
        expect(api.heightClassOf(height)).toBe(expected);
    });
});

describe('useWidthClass / useHeightClass', () => {
    it('seeds from __globalProps and follows screenChanged', async () => {
        const emitter = makeEmitter();
        installMockLynx(at(1024, 1366), emitter);   // iPad Air 13 portrait
        const api = await freshApi();

        const w = api.useWidthClass();
        const h = api.useHeightClass();
        expect(w.value).toBe('expanded');
        expect(h.value).toBe('expanded');

        // Rotate to landscape.
        emitter.emit('screenChanged', at(1366, 1024));
        expect(w.value).toBe('large');
        expect(h.value).toBe('expanded');
    });

    it('reports compact height for a phone in landscape', async () => {
        // iPhone 15 Pro landscape. Note the width alone says 'expanded' — the
        // same bucket as an iPad in portrait — which is exactly why a
        // width-only rule ships a vertical rail onto a 393dp-tall screen.
        installMockLynx(at(852, 393), makeEmitter());
        const api = await freshApi();
        expect(api.useWidthClass().value).toBe('expanded');
        // The height is the decisive fact here.
        expect(api.useHeightClass().value).toBe('compact');
    });

    it('falls back to the typical-phone constants off-device', async () => {
        const api = await freshApi();   // no lynx global at all
        expect(api.useWidthClass().value).toBe('compact');
        expect(api.useHeightClass().value).toBe('medium');
    });

    it('returns a stable computed across calls', async () => {
        installMockLynx(at(400, 800), makeEmitter());
        const api = await freshApi();
        expect(api.useWidthClass()).toBe(api.useWidthClass());
        expect(api.useHeightClass()).toBe(api.useHeightClass());
    });
});

describe('useWidthAtLeast / useHeightAtLeast', () => {
    it('answers against the live width', async () => {
        const emitter = makeEmitter();
        installMockLynx(at(400, 800), emitter);
        const api = await freshApi();

        const wide = api.useWidthAtLeast(api.Breakpoint.WIDTH_EXPANDED);
        expect(wide.value).toBe(false);

        emitter.emit('screenChanged', at(1024, 1366));
        expect(wide.value).toBe(true);
    });

    it('accepts an arbitrary threshold, compared against the real width', async () => {
        // 800 sits inside the 'medium' bucket, so a bucket-snapping
        // implementation would answer this wrong.
        installMockLynx(at(800, 1200), makeEmitter());
        const api = await freshApi();
        expect(api.useWidthAtLeast(720).value).toBe(true);
        expect(api.useWidthAtLeast(801).value).toBe(false);
    });

    it('is inclusive of the threshold', async () => {
        installMockLynx(at(840, 1200), makeEmitter());
        const api = await freshApi();
        expect(api.useWidthAtLeast(840).value).toBe(true);
    });

    it('memoizes per threshold', async () => {
        installMockLynx(at(400, 800), makeEmitter());
        const api = await freshApi();
        expect(api.useWidthAtLeast(600)).toBe(api.useWidthAtLeast(600));
        expect(api.useWidthAtLeast(600)).not.toBe(api.useWidthAtLeast(840));
    });

    it('does NOT re-notify for a width change that stays one side of the threshold', async () => {
        const emitter = makeEmitter();
        installMockLynx(at(900, 1300), emitter);
        const api = await freshApi();

        const wide = api.useWidthAtLeast(api.Breakpoint.WIDTH_EXPANDED);
        let runs = 0;
        const runner = effect(() => { void wide.value; runs++; });
        expect(runs).toBe(1);

        // Three resizes that all stay above 840 — a Stage Manager drag.
        emitter.emit('screenChanged', at(950, 1300));
        emitter.emit('screenChanged', at(1000, 1300));
        emitter.emit('screenChanged', at(1100, 1300));
        expect(runs).toBe(1);

        // Crossing the threshold does notify, exactly once.
        emitter.emit('screenChanged', at(800, 1300));
        expect(runs).toBe(2);
        expect(wide.value).toBe(false);

        runner.stop();
    });

    it('answers height independently of width', async () => {
        installMockLynx(at(852, 393), makeEmitter());
        const api = await freshApi();
        expect(api.useWidthAtLeast(api.Breakpoint.WIDTH_EXPANDED).value).toBe(true);
        expect(api.useHeightAtLeast(api.Breakpoint.HEIGHT_MEDIUM).value).toBe(false);
    });
});

describe('lazy wiring', () => {
    it('still subscribes when the first call races runtime init', async () => {
        // No emitter at first read — exactly the cold-start race `ensureWired()`
        // exists to survive. The hooks must keep calling `useScreen()` on every
        // invocation rather than only on a memo miss, or the retry is latched
        // away and the app sits on the seed for the whole session.
        installMockLynx(at(400, 800));            // no emitter yet
        const api = await freshApi();
        expect(api.useWidthClass().value).toBe('compact');

        // Runtime comes up and injects the emitter.
        const emitter = makeEmitter();
        installMockLynx(at(400, 800), emitter);

        // A later call has to retry the subscription...
        const w = api.useWidthClass();
        expect(emitter.listeners.get('screenChanged')?.size).toBe(1);

        // ...and the signal must now follow the publisher.
        emitter.emit('screenChanged', at(1024, 1366));
        expect(w.value).toBe('expanded');
    });

    it('retries from the predicate hooks too', async () => {
        installMockLynx(at(400, 800));
        const api = await freshApi();
        const first = api.useWidthAtLeast(840);
        expect(first.value).toBe(false);

        const emitter = makeEmitter();
        installMockLynx(at(400, 800), emitter);
        const again = api.useWidthAtLeast(840);
        expect(emitter.listeners.get('screenChanged')?.size).toBe(1);

        emitter.emit('screenChanged', at(1024, 1366));
        expect(again.value).toBe(true);
    });
});

describe('useWidthClassMT / useHeightClassMT', () => {
    it('reads __globalProps synchronously with no subscription', async () => {
        installMockLynx(at(1366, 1024));   // no emitter — MT path must not need one
        const api = await freshApi();
        expect(api.useWidthClassMT()).toBe('large');
        expect(api.useHeightClassMT()).toBe('expanded');
    });

    it('re-reads the current viewport on every call', async () => {
        installMockLynx(at(400, 800));
        const api = await freshApi();
        expect(api.useWidthClassMT()).toBe('compact');

        installMockLynx(at(1024, 1366));
        expect(api.useWidthClassMT()).toBe('expanded');
    });
});
