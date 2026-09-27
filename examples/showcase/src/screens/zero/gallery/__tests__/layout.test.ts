/**
 * The zero gallery's one-screen contract (#1192): every section of every
 * scope fits one iPhone 17 Pro screen (402×874pt, minus the safe frame), and
 * no cell is wider than its column, at every size of the daisy ramp. The
 * heights and widths come from each scope's `cell` model in `scopes.ts`,
 * which is computed from the skin's size tokens, so a ramp change that makes
 * a section overflow fails here instead of in a QA sweep.
 */
import { describe, expect, it } from 'vitest';
import type { GalleryAxis, GalleryScope, GalleryScopeId } from '../scopes.js';
import {
    CELL_PAD, FONT, GALLERY_SCOPES, SECTION_BUDGET, SIZES, axisPages, gallerySections,
    matrixOf, parseSection, rowHeight, sectionHeight, textWidth,
} from '../scopes.js';
import { pageThemeOf } from '../page-theme.js';

const SCOPES = Object.keys(GALLERY_SCOPES) as GalleryScopeId[];
const AXES: GalleryAxis[] = ['color', 'size', 'variant'];

describe('zero gallery layout', () => {
    describe.each(SCOPES)('%s', (scope) => {
        const entry: GalleryScope = GALLERY_SCOPES[scope];

        it('fits every axis section on one screen', () => {
            for (const section of gallerySections(scope)) {
                const parsed = parseSection(entry, section);
                expect(parsed, section).not.toBeNull();
                if (parsed?.kind !== 'axis') continue;
                const height = sectionHeight(entry, parsed.axis, parsed.values);
                expect(height, `${scope}/${section}: ${height.toFixed(1)}pt > ${SECTION_BUDGET}pt`).toBeLessThanOrEqual(SECTION_BUDGET);
            }
        });

        it('pages cover every axis value exactly once, in order', () => {
            for (const axis of AXES) {
                const values = entry.axes[axis];
                if (!values) continue;
                expect(axisPages(entry, axis).flat()).toEqual([...values]);
                // No single row is taller than a screen on its own.
                for (const value of values) {
                    expect(rowHeight(entry, axis, value), `${scope} ${axis}=${value}`).toBeLessThan(SECTION_BUDGET);
                }
            }
        });

        it('keeps every cell inside its column at every size', () => {
            const { cellWidth, columns, cellArea } = matrixOf(entry);
            expect(columns * cellWidth).toBeLessThanOrEqual(cellArea);
            for (const size of SIZES) {
                const { width } = entry.cell(size);
                // The box fits the column minus its right padding; a focus
                // ring's 4pt spread lands in that padding.
                expect(width, `${scope} @${size}: ${width.toFixed(1)}pt in a ${cellWidth}pt column`)
                    .toBeLessThanOrEqual(cellWidth - CELL_PAD);
            }
        });

        it('keeps every state label on one line', () => {
            const { cellWidth } = matrixOf(entry);
            for (const state of entry.states) {
                expect(textWidth(state.label, FONT.head), `${scope}: "${state.label}"`).toBeLessThanOrEqual(cellWidth);
            }
        });
    });

    it('gives an empty axis no pages', () => {
        const entry: GalleryScope = { ...GALLERY_SCOPES.switch, axes: { color: [] } };
        expect(axisPages(entry, 'color')).toEqual([]);
        expect(axisPages(entry, 'size')).toEqual([]);
    });

    it('splits the #1192 overflows into more pages', () => {
        // accordion/color-1 cut its neutral row; select/size-1 its md row.
        const accordion = GALLERY_SCOPES.accordion;
        expect(axisPages(accordion, 'color')[0]).not.toContain('neutral');
        const select = GALLERY_SCOPES.select;
        expect(axisPages(select, 'size')[0]).not.toContain('md');
    });
});

describe('zero gallery page theme', () => {
    it('mirrors a dark zero theme onto the daisy dark base', () => {
        expect(pageThemeOf({
            name: 'dim',
            colorScheme: 'dark',
            swatch: { 'base-100': '#2a303c', 'base-content': '#b2ccd6' },
        })).toEqual({
            base: 'daisy-dark',
            name: 'zero-gallery-dim',
            variant: 'dark',
            colors: { 'base-100': '#2a303c', 'base-content': '#b2ccd6' },
        });
    });

    it('mirrors a light zero theme onto the daisy light base', () => {
        expect(pageThemeOf({
            name: 'nord',
            colorScheme: 'light',
            swatch: { 'base-100': '#eceff4', 'base-content': '#2e3440' },
        })?.base).toBe('daisy-light');
    });

    it('leaves the page alone for an unknown theme or a swatch without base colours', () => {
        expect(pageThemeOf(undefined)).toBeNull();
        expect(pageThemeOf({ name: 'x', colorScheme: 'dark', swatch: { primary: '#000000' } })).toBeNull();
    });
});
