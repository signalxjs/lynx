import { describe, expect, it } from 'vitest';
import { lookupGlyph, registerIconSet } from '../src/registry';

describe('lookupGlyph', () => {
    it('prefers svg glyphs when both svg and codepoint are available', () => {
        registerIconSet({
            id: 'test-both',
            glyphs: {
                logo: {
                    codepoint: 0xf007,
                    svg: { svg: '<svg fill="__COLOR__"><path d="M0 0h24v24H0z"/></svg>' },
                },
            },
        });

        expect(lookupGlyph({}, {}, 'test-both', 'logo')).toEqual({
            svg: { svg: '<svg fill="__COLOR__"><path d="M0 0h24v24H0z"/></svg>' },
        });
    });

    it('falls back to codepoint glyphs when no svg is available', () => {
        registerIconSet({
            id: 'test-font',
            glyphs: {
                logo: {
                    codepoint: 0xf007,
                },
            },
        });

        expect(lookupGlyph({}, {}, 'test-font', 'logo')).toEqual({
            codepoint: 0xf007,
        });
    });
});
