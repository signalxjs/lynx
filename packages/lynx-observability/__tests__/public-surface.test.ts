/**
 * Public-surface freeze test for @sigx/lynx-observability.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as observability from '../src/index';
import { Memory } from '../src/index';
import type { MemoryQueryOptions, MemoryUsageSnapshot } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(observability).sort()).toEqual([
            'Memory',
            'createHttpSink',
            'initObservability',
            'installErrorCapture',
            'toError',
        ]);
    });

    it('exposes exactly the documented Memory methods', () => {
        expect(Object.keys(Memory).sort()).toEqual(['isAvailable', 'query']);
    });
});

describe('public types', () => {
    it('pins the query signature', () => {
        expectTypeOf(Memory.query)
            .toEqualTypeOf<(options?: MemoryQueryOptions) => Promise<MemoryUsageSnapshot>>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()` drifted
        // into returning a Promise, which makes `if (mod.isAvailable())`
        // silently always true.
        expectTypeOf(Memory.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Memory.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps memory.web.js in by extensionAlias, so a method added
        // to one and not the other is a runtime failure on the target that
        // missed it — invisible to a normal typecheck.
        const web = await import('../src/memory.web');
        expect(Object.keys(web.Memory).sort()).toEqual(Object.keys(Memory).sort());
    });

    it('reports unavailable and rejects rather than guessing a number', async () => {
        const web = await import('../src/memory.web');
        expect(web.Memory.isAvailable()).toBe(false);
        await expect(web.Memory.query()).rejects.toThrow(/not supported on web/);
    });

    it('the SHIPPED shim has no runtime import of ./memory.js', () => {
        // On web the plugin prepends `.web.js` to `resolve.extensionAlias`, so a
        // value import of `./memory.js` from this file resolves back to itself:
        // the shim imports itself and evaluation breaks before any call. Type
        // imports are erased and therefore fine, which is exactly why source
        // inspection can't catch this — assert on the built artifact, the same
        // way `lynx-core`'s logger test pins its `process`-free output.
        const dist = readFileSync(new URL('../dist/memory.web.js', import.meta.url), 'utf8');
        // Anchored to a statement: the file's own comment explains the hazard
        // and necessarily quotes the specifier, so a bare substring match would
        // fail on the documentation rather than on the defect.
        expect(dist).not.toMatch(/^\s*(?:import|export)\b[^\n]*from\s*['"]\.\/memory\.js['"]/m);
    });
});
