import { describe, expect, it } from 'vitest';
import { inlineSvg, sanitizeColor } from '../src/Icon';

describe('sanitizeColor', () => {
    it('passes through named colors', () => {
        expect(sanitizeColor('red')).toBe('red');
        expect(sanitizeColor('dodgerblue')).toBe('dodgerblue');
        expect(sanitizeColor('transparent')).toBe('transparent');
        expect(sanitizeColor('currentColor')).toBe('currentColor');
    });

    it('passes through #rgb / #rrggbb / #rrggbbaa hex', () => {
        expect(sanitizeColor('#fff')).toBe('#fff');
        expect(sanitizeColor('#0D9488')).toBe('#0D9488');
        expect(sanitizeColor('#FF0000AA')).toBe('#FF0000AA');
    });

    it('passes through rgb()/rgba()/hsl()/hsla() functions', () => {
        expect(sanitizeColor('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
        expect(sanitizeColor('rgba(255, 0, 0, 0.5)')).toBe('rgba(255, 0, 0, 0.5)');
        expect(sanitizeColor('hsl(120, 50%, 50%)')).toBe('hsl(120, 50%, 50%)');
        expect(sanitizeColor('hsla(120, 50%, 50%, 0.5)')).toBe('hsla(120, 50%, 50%, 0.5)');
    });

    it('rejects injection attempts and falls back to currentColor', () => {
        expect(sanitizeColor('red" stroke="black')).toBe('currentColor');
        expect(sanitizeColor('"><script>alert(1)</script>')).toBe('currentColor');
        expect(sanitizeColor('url(http://evil.com)')).toBe('currentColor');
        expect(sanitizeColor('red;background:blue')).toBe('currentColor');
        expect(sanitizeColor("red'/><foo")).toBe('currentColor');
    });

    it('rejects empty / random strings', () => {
        expect(sanitizeColor('')).toBe('currentColor');
        expect(sanitizeColor('   ')).toBe('currentColor');
        expect(sanitizeColor('not a color')).toBe('currentColor');
        expect(sanitizeColor('#xyz')).toBe('currentColor');
    });
});

describe('inlineSvg', () => {
    it('substitutes a safe color', () => {
        const template = '<svg fill="__COLOR__"><path d="M0 0"/></svg>';
        expect(inlineSvg(template, '#0D9488')).toBe(
            '<svg fill="#0D9488"><path d="M0 0"/></svg>',
        );
    });

    it('substitutes ALL placeholder occurrences (e.g. fill AND stroke)', () => {
        const template = '<svg fill="__COLOR__" stroke="__COLOR__"/>';
        expect(inlineSvg(template, 'red')).toBe('<svg fill="red" stroke="red"/>');
    });

    it('replaces unsafe color with currentColor, never letting the raw input through', () => {
        const template = '<svg fill="__COLOR__"/>';
        const result = inlineSvg(template, 'red" stroke="injected');
        expect(result).toBe('<svg fill="currentColor"/>');
        expect(result).not.toContain('injected');
        // Exactly two quotes — the opening and closing `fill=""`. Anything more
        // would mean the attribute got prematurely closed (the bug we're guarding).
        expect((result.match(/"/g) ?? []).length).toBe(2);
    });
});
