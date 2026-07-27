import { describe, it, expect } from 'vitest';
import { emojiInkFor, emojiRowPxFor, resolveEmojiGeometry } from '../src/metrics';

describe('per-platform ink table (#761)', () => {
    it('Android keeps the #674 WhatsApp calibration, everything else inks past the em', () => {
        expect(emojiInkFor('android')).toBe(0.64);
        // Apple's widest glyphs ink ~10% beyond the em — 0.93 and 1.0 both
        // clipped at the edge columns on device.
        expect(emojiInkFor('ios')).toBe(1.1);
        // Unknown/web hosts get the HIGH bucket: overestimated ink degrades
        // to airy spacing, underestimated to overlapping glyphs.
        expect(emojiInkFor('web')).toBe(1.1);
    });

    it('emojiRowPxFor: ink × em + 9px air', () => {
        expect(emojiRowPxFor(0.64, 32)).toBe(29); // historical Android default
        expect(emojiRowPxFor(0.64)).toBe(29);     // size defaults to 32
        expect(emojiRowPxFor(0.64, 60)).toBe(47); // adaptive Android phone row
        expect(emojiRowPxFor(1.1, 34)).toBe(46);  // adaptive iOS phone row
    });
});

describe('resolveEmojiGeometry', () => {
    it('resolves the #761 repro (402pt iPhone) to non-overlapping cells', () => {
        // Pre-fix this width produced a 58px em in a 40.2px cell (glyphs
        // collided). At worst-case ink the em sits at ~85% of the cell, so
        // even overshooting glyphs keep ~3px clear of the edge-column clip
        // line (0.93 and 1.0 both still clipped there on device).
        expect(resolveEmojiGeometry(402, 1.1)).toEqual({ columns: 10, cellSize: 34 });
    });

    it('pins the Android phone geometry (the Pixel look must not change)', () => {
        expect(resolveEmojiGeometry(412, 0.64)).toEqual({ columns: 10, cellSize: 60 });
        expect(resolveEmojiGeometry(328, 0.64)).toEqual({ columns: 8, cellSize: 60 });
    });

    it('explicit overrides win their half each and are never clamped', () => {
        expect(resolveEmojiGeometry(412, 0.64, { columns: 8 }).columns).toBe(8);
        expect(resolveEmojiGeometry(412, 0.64, { cellSize: 30 }).cellSize).toBe(30);
        expect(resolveEmojiGeometry(402, 1.1, { cellSize: 90 }).cellSize).toBe(90);
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
        for (const ink of [0.85, 1, 1.1]) {
            for (let width = 280; width <= 1000; width++) {
                const { columns, cellSize } = resolveEmojiGeometry(width, ink);
                expect(cellSize).toBeLessThanOrEqual(Math.floor(width / columns));
            }
        }
    });
});

describe('resolveEmojiGeometry — OS text-size setting (#811)', () => {
    // The picker used to hold one designed size at every text size ("pinned
    // like a keyboard panel"), which read as a stubbornly tiny grid next to
    // labels that had grown. It now follows the setting: bigger text →
    // FEWER, BIGGER columns.
    it('raising the font scale trades columns for cell size', () => {
        const at = (s: number) => resolveEmojiGeometry(448, 0.64, undefined, s);
        const base = at(1);
        const big = at(1.15);
        const bigger = at(1.3);

        expect(big.columns).toBeLessThan(base.columns);
        expect(bigger.columns).toBeLessThan(big.columns);
        expect(big.cellSize).toBeGreaterThan(base.cellSize);
        expect(bigger.cellSize).toBeGreaterThan(big.cellSize);
    });

    it('defaults to scale 1 — the pre-existing geometry is unchanged', () => {
        expect(resolveEmojiGeometry(412, 0.64)).toEqual(resolveEmojiGeometry(412, 0.64, undefined, 1));
    });

    it('scales the ink clamps too, so growth does not saturate at the cap', () => {
        // With the clamps fixed, a large text size would hit maxEm and stop
        // growing — the setting would appear to do nothing past a point.
        const a = resolveEmojiGeometry(448, 0.64, undefined, 1.3);
        const b = resolveEmojiGeometry(448, 0.64, undefined, 1.8);
        expect(b.cellSize).toBeGreaterThan(a.cellSize);
    });

    it('explicit overrides still win and are never scaled', () => {
        const g = resolveEmojiGeometry(448, 0.64, { columns: 8, cellSize: 40 }, 1.5);
        expect(g).toEqual({ columns: 8, cellSize: 40 });
    });

    it('treats a zero/negative scale as 1 rather than dividing by it', () => {
        const one = resolveEmojiGeometry(448, 0.64, undefined, 1);
        expect(resolveEmojiGeometry(448, 0.64, undefined, 0)).toEqual(one);
        expect(resolveEmojiGeometry(448, 0.64, undefined, -2)).toEqual(one);
    });

    it('never resolves fewer than the 7-column floor, however large the text', () => {
        expect(resolveEmojiGeometry(448, 0.64, undefined, 5).columns).toBe(7);
    });
});
