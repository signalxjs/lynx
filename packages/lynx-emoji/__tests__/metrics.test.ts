import { describe, it, expect } from 'vitest';
import { emojiInkFor, emojiRowPxFor, resolveEmojiGeometry } from '../src/metrics';

describe('per-platform ink table (#761)', () => {
    it('Android keeps the #674 WhatsApp calibration, everything else inks near the em', () => {
        expect(emojiInkFor('android')).toBe(0.64);
        expect(emojiInkFor('ios')).toBe(0.93);
        // Unknown/web hosts get the HIGH bucket: overestimated ink degrades
        // to airy spacing, underestimated to overlapping glyphs.
        expect(emojiInkFor('web')).toBe(0.93);
    });

    it('emojiRowPxFor: ink × em + 9px air', () => {
        expect(emojiRowPxFor(0.64, 32)).toBe(29); // historical Android default
        expect(emojiRowPxFor(0.64)).toBe(29);     // size defaults to 32
        expect(emojiRowPxFor(0.64, 60)).toBe(47); // adaptive Android phone row
        expect(emojiRowPxFor(0.93, 40)).toBe(46); // adaptive iOS phone row
    });
});

describe('resolveEmojiGeometry', () => {
    it('resolves the #761 repro (402pt iPhone) to non-overlapping cells', () => {
        // Pre-fix this width produced a 58px em in a 40.2px cell (glyphs
        // collided); at the real Apple ink the em fits the cell exactly.
        expect(resolveEmojiGeometry(402, 0.93)).toEqual({ columns: 10, cellSize: 40 });
    });

    it('pins the Android phone geometry (the Pixel look must not change)', () => {
        expect(resolveEmojiGeometry(412, 0.64)).toEqual({ columns: 10, cellSize: 60 });
        expect(resolveEmojiGeometry(328, 0.64)).toEqual({ columns: 8, cellSize: 60 });
    });

    it('explicit overrides win their half each and are never clamped', () => {
        expect(resolveEmojiGeometry(412, 0.64, { columns: 8 }).columns).toBe(8);
        expect(resolveEmojiGeometry(412, 0.64, { cellSize: 30 }).cellSize).toBe(30);
        expect(resolveEmojiGeometry(402, 0.93, { cellSize: 90 }).cellSize).toBe(90);
    });

    it('Android output is bit-identical to the historical single-constant formula', () => {
        // The pre-#761 math, verbatim: min(72, max(24, round(cellW*0.93/0.64))).
        for (let width = 280; width <= 1000; width++) {
            const { columns, cellSize } = resolveEmojiGeometry(width, 0.64);
            const legacyColumns = Math.min(12, Math.max(7, Math.floor(width / 40)));
            const legacyCell = Math.min(72, Math.max(24,
                Math.round(((width / legacyColumns) * 0.93) / 0.64)));
            expect(columns).toBe(legacyColumns);
            expect(cellSize).toBe(legacyCell);
        }
    });

    it('near-em platforms can never declare an em wider than the cell', () => {
        // The #761 safety clamp: a wrong-low table entry must degrade to airy
        // spacing, never overlap — so for inks ≥ 0.85 the em is capped at the
        // cell width across the whole realistic width range.
        for (const ink of [0.85, 0.93, 1]) {
            for (let width = 280; width <= 1000; width++) {
                const { columns, cellSize } = resolveEmojiGeometry(width, ink);
                expect(cellSize).toBeLessThanOrEqual(Math.floor(width / columns));
            }
        }
    });
});
