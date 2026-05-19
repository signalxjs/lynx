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
        expect(g?.svg).toMatch(/^<svg /);
        expect(g?.svg).toContain('viewBox="0 0 448 512"');
        expect(g?.svg).toContain('fill="__COLOR__"');
        expect(g?.svg).toContain('<path d="');
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

    describe('listGlyphs', () => {
        it('enumerates the full FA solid catalog (1000+ kebab-case names)', () => {
            const all = adapter.listGlyphs('solid');
            expect(all.length).toBeGreaterThan(1000);
            // Sanity-check a few well-known names are present.
            expect(all).toContain('user');
            expect(all).toContain('chevron-right');
            expect(all).toContain('house');
            expect(all).toContain('gear');
        });

        it('enumerates brands', () => {
            const all = adapter.listGlyphs('brands');
            expect(all.length).toBeGreaterThan(400);
            expect(all).toContain('github');
        });

        it('filters out non-icon exports (prefix / fas / far / fab)', () => {
            const solid = adapter.listGlyphs('solid');
            expect(solid).not.toContain('prefix');
            expect(solid).not.toContain('');
            // The module's `fas` / single-letter prefix exports should be skipped.
            for (const name of solid) {
                expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
            }
        });

        it('returns [] for unknown style', () => {
            expect(adapter.listGlyphs('thin' as never)).toEqual([]);
        });

        it('round-trips with getGlyph (every listed name resolves)', () => {
            const all = adapter.listGlyphs('solid');
            // Spot-check the first 20 to keep the test fast — full coverage
            // would be O(1400) getGlyph calls per run.
            for (const name of all.slice(0, 20)) {
                const g = adapter.getGlyph('solid', name);
                expect(g, `getGlyph('solid', '${name}') should not be null`).not.toBeNull();
            }
        });
    });
});
