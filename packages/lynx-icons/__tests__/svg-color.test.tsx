/**
 * #949 — how the resolved color reaches the glyph on each transport.
 *
 * Native (`svg-color.ts`): the markup is standard SVG painting from
 * `currentColor`, and the color rides the `<svg current-color>` attribute
 * (Lynx 4.0+). Web (`svg-color.web.ts`): `x-svg` has no such attribute, so
 * the color is substituted into the markup's `currentColor` paints. Vitest
 * resolves the native module for `./svg-color.js`; the web twin is imported
 * explicitly.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render } from '@sigx/lynx-testing';

import { resolveSvgColor } from '../src/svg-color';
import { inlineSvg, resolveSvgColor as resolveSvgColorWeb } from '../src/svg-color.web';
import { Icon } from '../src/Icon';
import { registerIconSet } from '../src/registry';

const STANDARD = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M0 0h24v24H0z"/></svg>';
const LEGACY = '<svg fill="__COLOR__" stroke="__COLOR__"/>';

describe('resolveSvgColor (native)', () => {
    it('leaves standard currentColor markup alone and injects the color as the attribute', () => {
        const r = resolveSvgColor(STANDARD, '#0D9488');
        expect(r.content).toBe(STANDARD);
        expect(r.currentColor).toBe('#0D9488');
    });

    it('rewrites the legacy __COLOR__ placeholder to currentColor so old sets still paint', () => {
        const r = resolveSvgColor(LEGACY, 'red');
        expect(r.content).toBe('<svg fill="currentColor" stroke="currentColor"/>');
        expect(r.currentColor).toBe('red');
    });

    it('injects nothing when the color is currentColor itself (engine fallback paints)', () => {
        expect(resolveSvgColor(STANDARD, 'currentColor').currentColor).toBeUndefined();
    });

    it('never forwards an unsafe value — it collapses to no attribute', () => {
        const r = resolveSvgColor(STANDARD, 'red" stroke="injected');
        expect(r.currentColor).toBeUndefined();
        expect(r.content).not.toContain('injected');
    });
});

describe('inlineSvg / resolveSvgColor (web twin)', () => {
    it('substitutes a safe color into fill/stroke currentColor paints', () => {
        expect(inlineSvg('<svg fill="currentColor" stroke="currentColor"/>', '#0D9488')).toBe(
            '<svg fill="#0D9488" stroke="#0D9488"/>',
        );
    });

    it('substitutes the legacy placeholder too', () => {
        expect(inlineSvg(LEGACY, 'red')).toBe('<svg fill="red" stroke="red"/>');
    });

    it('does not touch explicit paints', () => {
        const explicit = '<svg fill="none" stroke="#123456"><path d="M0 0"/></svg>';
        expect(inlineSvg(explicit, 'red')).toBe(explicit);
    });

    it('replaces an unsafe color with currentColor, never letting the raw input through', () => {
        const result = inlineSvg('<svg fill="__COLOR__"/>', 'red" stroke="injected');
        expect(result).toBe('<svg fill="currentColor"/>');
        expect(result).not.toContain('injected');
        expect(result.match(/"/g)?.length).toBe(2);
    });

    it('never sets the attribute — web has no current-color', () => {
        const r = resolveSvgColorWeb(STANDARD, '#0D9488');
        expect(r.currentColor).toBeUndefined();
        expect(r.content).toContain('fill="#0D9488"');
    });
});

describe('<Icon> svg mode', () => {
    beforeAll(() => {
        registerIconSet({ id: 'cc-test', glyphs: { box: { svg: { svg: STANDARD } } } });
    });

    it('hands the engine standard markup plus current-color', () => {
        const { container } = render(<Icon set="cc-test" name="box" color="#0D9488" />);
        const el = container.findByType('svg')!;
        expect(el.props.content).toBe(STANDARD);
        expect(el.props['current-color']).toBe('#0D9488');
    });

    it('omits current-color when nothing resolved a color', () => {
        const { container } = render(<Icon set="cc-test" name="box" />);
        const el = container.findByType('svg')!;
        expect(el.props.content).toBe(STANDARD);
        expect(el.props['current-color']).toBeUndefined();
    });
});
