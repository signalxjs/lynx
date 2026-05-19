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
});
