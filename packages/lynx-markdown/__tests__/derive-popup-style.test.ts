import { describe, it, expect } from 'vitest';
import { derivePopupStyleFromText } from '../src/editor/trigger/SuggestionPopup';

describe('derivePopupStyleFromText', () => {
    it('returns {} for absent or empty input (keeps neutral standalone defaults)', () => {
        expect(derivePopupStyleFromText()).toEqual({});
        expect(derivePopupStyleFromText('')).toEqual({});
    });

    it('returns {} for non-hex colors (named / rgb())', () => {
        expect(derivePopupStyleFromText('white')).toEqual({});
        expect(derivePopupStyleFromText('rgb(255, 255, 255)')).toEqual({});
        expect(derivePopupStyleFromText('#xyz')).toEqual({});
    });

    it('returns {} for hex with non-hex digits in any position (incl. the alpha bytes)', () => {
        expect(derivePopupStyleFromText('#fffz')).toEqual({}); // bad alpha nibble
        expect(derivePopupStyleFromText('#ffffffzz')).toEqual({}); // bad alpha byte
        expect(derivePopupStyleFromText('#12345g')).toEqual({}); // bad rgb digit
        expect(derivePopupStyleFromText('#ff')).toEqual({}); // wrong length
    });

    it('light text (dark theme) ⇒ dark surface, text passes through', () => {
        const s = derivePopupStyleFromText('#e6e6e6');
        expect(s.surfaceColor).toBe('#1f1f23');
        expect(s.textColor).toBe('#e6e6e6');
        expect(s.borderColor).toBe('rgba(230, 230, 230, 0.25)');
        expect(s.activeColor).toBe('rgba(230, 230, 230, 0.12)');
    });

    it('dark text (light theme) ⇒ light surface', () => {
        const s = derivePopupStyleFromText('#1a1a2e');
        expect(s.surfaceColor).toBe('#f4f4f5');
        expect(s.borderColor).toBe('rgba(26, 26, 46, 0.25)');
    });

    it('expands shorthand hex and ignores the alpha channel', () => {
        expect(derivePopupStyleFromText('#fff').surfaceColor).toBe('#1f1f23'); // #ffffff → light text
        expect(derivePopupStyleFromText('#000').surfaceColor).toBe('#f4f4f5'); // #000000 → dark text
        // #RRGGBBAA: alpha ignored for the luminance decision.
        const s = derivePopupStyleFromText('#ffffff80');
        expect(s.surfaceColor).toBe('#1f1f23');
        expect(s.borderColor).toBe('rgba(255, 255, 255, 0.25)');
    });
});
