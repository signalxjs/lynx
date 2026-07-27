import { describe, it, expect } from 'vitest';
import adapter from '../src/index.js';

describe('@sigx/lynx-icons-lucide adapter', () => {
    it('reports exactly one (empty) style', () => {
        expect(adapter.styles).toEqual(['']);
    });

    it('always returns null TTF path (SVG-only)', () => {
        expect(adapter.getFontPath('')).toBeNull();
        expect(adapter.getFontPath('solid' as never)).toBeNull();
    });

    it('resolves a kebab-case glyph (user)', () => {
        const g = adapter.getGlyph('', 'user');
        expect(g).not.toBeNull();
        expect(g?.codepoint).toBeUndefined();
        expect(g?.svg).toMatch(/^<svg /);
        expect(g?.svg).toContain('viewBox="0 0 24 24"');
        expect(g?.svg).toContain('stroke="__COLOR__"');
        expect(g?.svg).toContain('fill="none"');
        // User icon is a path + a circle.
        expect(g?.svg).toContain('<path ');
        expect(g?.svg).toContain('<circle ');
    });

    it('resolves a multi-segment kebab name (chevron-right)', () => {
        const g = adapter.getGlyph('', 'chevron-right');
        expect(g).not.toBeNull();
        expect(g?.svg).toContain('<path ');
    });

    it('returns null for unknown glyph', () => {
        expect(adapter.getGlyph('', 'definitely-not-a-lucide-icon')).toBeNull();
    });

    // Lynx's `<svg content=…>` silently drops <line>/<polyline>/<polygon>:
    // `hash` painted nothing at all and `smile` lost its eyes (#811). All
    // three convert losslessly to <path>, which does paint.
    describe('primitives Lynx cannot paint are emitted as <path>', () => {
        it('converts <line> (hash is four lines and nothing else)', () => {
            const svg = adapter.getGlyph('', 'hash')?.svg ?? '';
            expect(svg).not.toContain('<line ');
            expect(svg.match(/<path /g) ?? []).toHaveLength(4);
            // 4,9 → 20,9 is hash's first rule.
            expect(svg).toContain('d="M4 9L20 9"');
        });

        it('keeps the shapes that DO paint as they are', () => {
            const svg = adapter.getGlyph('', 'user')?.svg ?? '';
            expect(svg).toContain('<circle ');
        });

        it('converts <polyline> to an open path', () => {
            // album = rect + polyline "11 3 11 11 14 8 17 11 17 3"
            const svg = adapter.getGlyph('', 'album')?.svg ?? '';
            expect(svg).not.toContain('<polyline ');
            expect(svg).toContain('d="M11 3L11 11L14 8L17 11L17 3"');
            expect(svg).not.toContain('Z"');
        });

        it('converts <polygon> to a CLOSED path', () => {
            // navigation = polygon "3 11 22 2 13 21 11 13 3 11"
            const svg = adapter.getGlyph('', 'navigation')?.svg ?? '';
            expect(svg).not.toContain('<polygon ');
            expect(svg).toContain('d="M3 11L22 2L13 21L11 13L3 11Z"');
        });

        it('leaves no lucide icon emitting an unpaintable primitive', () => {
            for (const name of adapter.listGlyphs('')) {
                const svg = adapter.getGlyph('', name)?.svg ?? '';
                expect(svg, name).not.toMatch(/<(?:line|polyline|polygon)\s/);
            }
        });
    });

    describe('listGlyphs', () => {
        it('enumerates the full Lucide catalog (1000+ kebab-case names)', () => {
            const all = adapter.listGlyphs('');
            expect(all.length).toBeGreaterThan(1000);
            expect(all).toContain('user');
            expect(all).toContain('search');
            expect(all).toContain('chevron-right');
            expect(all).toContain('bell');
        });

        it('handles names that start with two capitals (a-arrow-down)', () => {
            // Lucide really exports `AArrowDown` — confirm the kebab inverse handles it.
            const all = adapter.listGlyphs('');
            expect(all).toContain('a-arrow-down');
        });

        it('only emits kebab-case (no PascalCase / camelCase leaks)', () => {
            for (const name of adapter.listGlyphs('')) {
                expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
            }
        });

        it('round-trips with getGlyph (every listed name resolves)', () => {
            const all = adapter.listGlyphs('');
            for (const name of all.slice(0, 20)) {
                expect(adapter.getGlyph('', name), `getGlyph('', '${name}') should not be null`).not.toBeNull();
            }
        });
    });
});
