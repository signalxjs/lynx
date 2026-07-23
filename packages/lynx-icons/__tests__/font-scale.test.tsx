/**
 * Icon sizing vs the OS font scale (#776).
 *
 * The engine multiplies font-relevant lengths (fontSize/lineHeight) by the
 * effective scale; layout lengths (width/height) never scale. The component
 * therefore:
 *  - default (pinned): keeps the box at `size` and counter-divides the
 *    font-mode glyph so the engine's multiply lands back on `size`;
 *  - `scaleWithText`: grows the box to `size * scale` and passes the glyph
 *    fontSize through for the engine to scale.
 *
 * The core font-scale signal seeds lazily from `lynx.__globalProps` and
 * LATCHES module-wide — the mock is installed before the first render and
 * kept for the whole file; the unwired (scale=1) expectations are asserted
 * arithmetically instead of via a separate unwired render.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render } from '@sigx/lynx-testing';

import { Icon } from '../src/Icon';
import { registerIconSet } from '../src/registry';

const SCALE = 1.5;

beforeAll(() => {
    (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: { fontScale: { scale: SCALE, os: SCALE } },
    };
    registerIconSet({
        id: 'test-svg',
        glyphs: {
            box: { svg: { svg: '<svg fill="__COLOR__"><path d="M0 0h24v24H0z"/></svg>' } },
        },
    });
    registerIconSet({
        id: 'test-font',
        glyphs: {
            user: { codepoint: 0xf007 },
        },
    });
});

afterAll(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

describe('<Icon> under OS font scale (effective 1.5)', () => {
    it('svg mode, default: box stays at the designed size', () => {
        const { container } = render(<Icon set="test-svg" name="box" size={20} />);
        const el = container.findByType('svg')!;
        expect(el._style.width).toBe(20);
        expect(el._style.height).toBe(20);
    });

    it('svg mode, scaleWithText: box grows by the scale', () => {
        const { container } = render(<Icon set="test-svg" name="box" size={20} scaleWithText={true} />);
        const el = container.findByType('svg')!;
        expect(el._style.width).toBe(30);
        expect(el._style.height).toBe(30);
    });

    it('font mode, default: glyph counter-divided, box pinned — no clipping', () => {
        const { container } = render(<Icon set="test-font" name="user" size={24} />);
        const el = container.findByType('text')!;
        // Engine multiplies fontSize by 1.5 → renders exactly 24.
        expect(el._style.fontSize).toBe(16);
        expect(el._style.lineHeight).toBe('16px');
        expect(el._style.width).toBe(24);
        expect(el._style.height).toBe(24);
    });

    it('font mode, scaleWithText: glyph passed through, box grows to match', () => {
        const { container } = render(<Icon set="test-font" name="user" size={24} scaleWithText={true} />);
        const el = container.findByType('text')!;
        expect(el._style.fontSize).toBe(24);       // engine scales to 36
        expect(el._style.lineHeight).toBe('24px');
        expect(el._style.width).toBe(36);           // matches the scaled glyph
        expect(el._style.height).toBe(36);
    });

    it('missing glyph placeholder follows the same box rule', () => {
        const a = render(<Icon set="test-svg" name="nope" size={20} />);
        expect(a.container.findByType('view')!._style.width).toBe(20);
        const b = render(<Icon set="test-svg" name="nope" size={20} scaleWithText={true} />);
        expect(b.container.findByType('view')!._style.width).toBe(30);
    });
});
