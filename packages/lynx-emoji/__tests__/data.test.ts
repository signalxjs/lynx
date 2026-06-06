import { describe, it, expect } from 'vitest';
import { data } from '../src/data/en.gen';
import { glyphForTone } from '../src/data/glyph';

describe('generated en dataset', () => {
    it('carries the expected overall shape', () => {
        expect(data.locale).toBe('en');
        // 10 CLDR groups minus the component group.
        expect(data.categories).toHaveLength(9);
        expect(data.categories[0]).toEqual({ key: 'smileys-emotion', label: 'smileys & emotion' });
        expect(data.emojis.length).toBeGreaterThan(1800);
        expect(data.skinTones).toHaveLength(5);
        expect(data.skinTones[0]).toMatch(/light/);
        expect(data.skinTones[4]).toMatch(/dark/);
    });

    it('every entry is well-formed', () => {
        for (const e of data.emojis) {
            expect(e.e.length).toBeGreaterThan(0);
            expect(e.n.length).toBeGreaterThan(0);
            expect(e.c).toBeGreaterThanOrEqual(0);
            expect(e.c).toBeLessThan(data.categories.length);
            if (e.s) expect(e.s).toHaveLength(5);
            for (const sc of e.sc ?? []) expect(sc).toBe(sc.toLowerCase());
        }
    });

    it('is sorted so category sections are contiguous', () => {
        for (let i = 1; i < data.emojis.length; i++) {
            const prev = data.emojis[i - 1];
            const cur = data.emojis[i];
            expect(cur.c >= prev.c).toBe(true);
            if (cur.c === prev.c) expect(cur.o >= prev.o).toBe(true);
        }
    });

    it('resolves well-known emoji', () => {
        const joy = data.emojis.find((e) => e.sc?.includes('joy'));
        expect(joy?.e).toBe('😂');
        const wave = data.emojis.find((e) => e.n === 'waving hand');
        expect(wave?.s).toHaveLength(5);
    });
});

describe('glyphForTone', () => {
    const wave = data.emojis.find((e) => e.n === 'waving hand')!;
    const joy = data.emojis.find((e) => e.sc?.includes('joy'))!;

    it('returns the base glyph for tone 0 and non-tonal emoji', () => {
        expect(glyphForTone(wave, 0)).toBe(wave.e);
        expect(glyphForTone(joy, 3)).toBe(joy.e);
    });

    it('returns the variant for tonal emoji', () => {
        expect(glyphForTone(wave, 1)).toBe('👋🏻');
        expect(glyphForTone(wave, 5)).toBe('👋🏿');
    });
});
