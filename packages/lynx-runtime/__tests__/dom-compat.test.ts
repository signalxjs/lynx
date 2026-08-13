/**
 * #1059 — the @sigx/runtime-dom alias names: they must EXIST (ESM linking
 * resolves every re-export in the `sigx` entry whether or not it is
 * called) and must FAIL LOUDLY if something actually calls them on this
 * platform.
 */
import { describe, expect, it } from 'vitest';
import { Portal, moveNode, supportsMoveBefore, useHead } from '../src/index.js';

describe('dom-compat', () => {
    it('supportsMoveBefore is a constant false — no DOM to move nodes in', () => {
        expect(supportsMoveBefore).toBe(false);
    });

    it('the unsupported APIs throw with a platform message when invoked', () => {
        expect(() => Portal()).toThrow(/no lynx counterpart/);
        expect(() => moveNode()).toThrow(/no lynx counterpart/);
        expect(() => useHead()).toThrow(/no lynx counterpart/);
    });
});
