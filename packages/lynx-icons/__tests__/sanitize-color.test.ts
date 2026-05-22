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

    it('passes through var(--name) custom-property references', () => {
        // Theme packages may return `var(--color-primary)` etc. from
        // `useIconColorResolver`. Lynx's SVG content parser doesn't
        // evaluate var() in `fill=` today (we substitute the resolved
        // hex via the daisy palette instead), but the regex accepts it
        // so the day Lynx grows that support nothing here blocks.
        expect(sanitizeColor('var(--color-primary)')).toBe('var(--color-primary)');
        expect(sanitizeColor('var(--my-brand-token)')).toBe('var(--my-brand-token)');
        expect(sanitizeColor('var( --spaced )')).toBe('var( --spaced )');
    });

    it('rejects var() variants that could enable attribute injection', () => {
        // No fallback form (`var(--x, red)`) — the comma + arbitrary
        // fallback expression opens a quoting/injection surface. Falls
        // back to currentColor. Same for malformed inputs.
        expect(sanitizeColor('var(--name, red)')).toBe('currentColor');
        expect(sanitizeColor('var(--x") url(bad')).toBe('currentColor');
        expect(sanitizeColor('var(no-double-dash)')).toBe('currentColor');
        expect(sanitizeColor('var(--name)/* hack */')).toBe('currentColor');
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
