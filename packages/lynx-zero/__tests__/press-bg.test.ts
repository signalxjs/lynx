/**
 * Tier-2 press feel (#1143), background half: `createPressFeedback` compiled
 * with the SWC worklet transform's JS (background) target, the way a real
 * bundle ships it — so the transform-detection probe sees placeholders and
 * the main-thread handler family is wired. (The plain unit renderer never
 * runs the transform and exercises the tier-1 fallback instead.)
 */
import { createRequire } from 'module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signal } from '@sigx/lynx';
import type { createPressFeedback as CreatePressFeedback } from '../src/behaviors/press';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src/behaviors/press.ts');

interface JsFnStub {
    _jsFnId: number;
    fn: () => void;
}

let createPressFeedback: typeof CreatePressFeedback;
let dir = '';

afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeAll(async () => {
    // The transform ships with @lynx-js/react, a dependency of the testing
    // package — resolve it from there.
    const fromTesting = createRequire(resolve(HERE, '../../lynx-testing/package.json'));
    const mod = fromTesting('@lynx-js/react/transform') as {
        transformReactLynxSync: (code: string, options: unknown) => { code: string; errors: unknown[] };
    };
    const ts = readFileSync(SRC, 'utf8');
    const out = mod.transformReactLynxSync(ts, {
        pluginName: 'sigx:test',
        filename: SRC,
        sourcemap: false,
        cssScope: false,
        shake: false,
        compat: false,
        refresh: false,
        defineDCE: false,
        directiveDCE: false,
        snapshot: false,
        worklet: { target: 'JS', filename: SRC, runtimePkg: '@sigx/lynx-runtime-main' },
    });
    expect(out.errors).toEqual([]);
    // Point the bare specifier at the very module instance this test uses.
    const lynxEntry = await import.meta.resolve!('@sigx/lynx');
    const code = out.code
        .replace(/from '@sigx\/lynx'/g, `from ${JSON.stringify(lynxEntry)}`)
        // The worklet runtime's BG half: a stub that keeps the callback.
        .replace(/import \{ transformToWorklet as __transformToWorklet \} from [^;]+;/, 'const __transformToWorklet = globalThis.__transformToWorklet;');
    let ids = 0;
    (globalThis as Record<string, unknown>)['__transformToWorklet'] = (fn: () => void): JsFnStub => ({ _jsFnId: ++ids, fn });
    dir = mkdtempSync(join(tmpdir(), 'lynx-zero-press-'));
    const file = join(dir, 'press.mjs');
    writeFileSync(file, code);
    ({ createPressFeedback } = await import(/* @vite-ignore */ pathToFileURL(file).href));
});

type Placeholder = { _wkltId: string; _c: Record<string, unknown>; _jsFn: { _jsFn1: JsFnStub } };

describe('createPressFeedback — compiled for a real bundle', () => {
    it('wires the main-thread handler family, and no background touch handlers', () => {
        const press = createPressFeedback();
        expect(press.mainThread).toBe(true);
        const h = press.handlers as unknown as Record<string, Placeholder>;
        expect(Object.keys(h).sort()).toEqual([
            'main-thread-bindtouchcancel', 'main-thread-bindtouchend', 'main-thread-bindtouchstart',
        ]);
        expect(typeof h['main-thread-bindtouchstart']!._wkltId).toBe('string');
        // end and cancel share the release worklet
        expect(h['main-thread-bindtouchend']).toBe(h['main-thread-bindtouchcancel']);
        expect(h['main-thread-bindtouchstart']!._c['scale']).toBe(0.97);
        expect(h['main-thread-bindtouchstart']!._c['opacity']).toBe(-1);
    });

    it('the background callbacks drive tier 1; disabled suppresses and clears it', () => {
        const disabled = signal({ on: false });
        const press = createPressFeedback({ isDisabled: () => disabled.on });
        const h = press.handlers as unknown as Record<string, Placeholder>;
        const down = h['main-thread-bindtouchstart']!._jsFn._jsFn1.fn;
        const up = h['main-thread-bindtouchend']!._jsFn._jsFn1.fn;
        down();
        expect(press.pressed()).toBe(true);
        up();
        expect(press.pressed()).toBe(false);
        down();
        disabled.on = true;
        // Turning disabled mid-press drops the flag.
        expect(press.pressed()).toBe(false);
        down();
        expect(press.pressed()).toBe(false);
    });

    it('feel tunes the capture; feel: false keeps tier 1 only', () => {
        const tuned = createPressFeedback({ feel: { scale: 0.9, opacity: 0.85 } });
        const c = (tuned.handlers as unknown as Record<string, Placeholder>)['main-thread-bindtouchstart']!._c;
        expect(c['scale']).toBe(0.9);
        expect(c['opacity']).toBe(0.85);

        const off = createPressFeedback({ feel: false });
        expect(off.mainThread).toBe(false);
        expect(Object.keys(off.handlers).sort()).toEqual(['bindtouchcancel', 'bindtouchend', 'bindtouchstart']);
    });
});
