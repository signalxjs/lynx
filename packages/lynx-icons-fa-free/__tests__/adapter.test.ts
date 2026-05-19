import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import adapter from '../src/index.js';

describe('@sigx/lynx-icons-fa-free adapter', () => {
    it('advertises solid, regular, and brands', () => {
        expect(adapter.styles).toEqual(['solid', 'regular', 'brands']);
    });

    it('resolves a known solid glyph (user)', () => {
        const g = adapter.getGlyph('solid', 'user');
        expect(g).not.toBeNull();
        expect(g?.codepoint).toBe(0xf007);
        expect(g?.w).toBeGreaterThan(0);
        expect(g?.h).toBeGreaterThan(0);
        expect(typeof g?.path).toBe('string');
        expect(g?.path.length).toBeGreaterThan(10);
    });

    it('resolves a kebab-cased glyph name (chevron-right)', () => {
        const g = adapter.getGlyph('solid', 'chevron-right');
        expect(g).not.toBeNull();
        expect(g?.codepoint).toBe(0xf054);
    });

    it('resolves a brand glyph (github)', () => {
        const g = adapter.getGlyph('brands', 'github');
        expect(g).not.toBeNull();
        expect(g?.codepoint).toBeGreaterThan(0);
    });

    it('returns null for unknown glyph', () => {
        const g = adapter.getGlyph('solid', 'definitely-not-a-real-glyph-name-xyz');
        expect(g).toBeNull();
    });

    it('returns null for unknown style', () => {
        const g = adapter.getGlyph('duotone' as never, 'user');
        expect(g).toBeNull();
    });

    it('resolves an absolute TTF path that exists on disk', () => {
        const p = adapter.getFontPath('solid');
        expect(p).not.toBeNull();
        expect(p).toMatch(/fa-solid-900\.ttf$/);
        expect(existsSync(p!)).toBe(true);
    });

    it('returns null TTF path for unknown style', () => {
        const p = adapter.getFontPath('thin' as never);
        expect(p).toBeNull();
    });
});
