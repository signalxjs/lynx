import { describe, it, expect } from 'vitest';
import adapter from '../src/index.js';

describe('@sigx/lynx-icons-mdi adapter', () => {
    it('reports exactly one (empty) style', () => {
        expect(adapter.styles).toEqual(['']);
    });

    it('always returns null TTF path (SVG-only)', () => {
        expect(adapter.getFontPath('')).toBeNull();
        expect(adapter.getFontPath('solid' as never)).toBeNull();
    });

    it('resolves a kebab-case glyph (menu) as a single filled path', () => {
        const g = adapter.getGlyph('', 'menu');
        expect(g).not.toBeNull();
        expect(g?.codepoint).toBeUndefined();
        expect(g?.svg).toMatch(/^<svg /);
        expect(g?.svg).toContain('viewBox="0 0 24 24"');
        expect(g?.svg).toContain('fill="currentColor"');
        expect(g?.svg.match(/<path /g) ?? []).toHaveLength(1);
        expect(g?.svg).toMatch(/<path d="M[^"]+"\/><\/svg>$/);
    });

    it.each([
        'signal-cellular-outline',
        'battery-10',
        'alpha-a-box',
        'numeric-10-box-outline',
        'home-variant-outline',
    ])('resolves a multi-segment kebab name (%s)', (name) => {
        expect(adapter.getGlyph('', name)).not.toBeNull();
    });

    it('returns null for unknown glyph', () => {
        expect(adapter.getGlyph('', 'definitely-not-an-mdi-icon')).toBeNull();
    });

    describe('listGlyphs', () => {
        it('enumerates the full MDI catalog (5000+ kebab-case names)', () => {
            const all = adapter.listGlyphs('');
            expect(all.length).toBeGreaterThan(5000);
            expect(all).toContain('menu');
            expect(all).toContain('signal-cellular-outline');
            expect(all).toContain('battery-10');
            expect(all).toContain('alpha-a-box');
        });

        it('only emits kebab-case (no PascalCase / camelCase leaks)', () => {
            for (const name of adapter.listGlyphs('')) {
                expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
            }
        });

        it('round-trips with getGlyph (every listed name resolves)', () => {
            // The kebab inverse has to agree with the forward mapping for
            // every digit/letter combination MDI uses, so check them all.
            for (const name of adapter.listGlyphs('')) {
                expect(adapter.getGlyph('', name), `getGlyph('', '${name}') should not be null`).not.toBeNull();
            }
        });
    });
});
