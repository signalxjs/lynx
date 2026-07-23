/**
 * Picker pinning vs the OS font scale (#776).
 *
 * The engine multiplies font-relevant lengths by the effective scale; the
 * picker is a keyboard-style fixed-geometry panel, so every glyph/label
 * fontSize is counter-divided to hold its designed size — keeping the
 * est==actual row-geometry contract (#663) intact by construction.
 *
 * The core font-scale signal seeds lazily from `lynx.__globalProps` and
 * latches module-wide; vitest isolates module graphs per test FILE, so the
 * mock installed here does not leak into the other emoji test files.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, getAllByType, getByType, act } from '@sigx/lynx-testing';
import { EmojiPicker } from '../src/components/EmojiPicker';
import { emojiRowPx } from '../src/components/EmojiCell';
import { HEADER_PX } from '../src/components/SectionHeader';
import { emojiInkRatio } from '../src/metrics';
import type { EmojiData, EmojiDatum } from '../src/data/schema';

const SCALE = 1.5;

const makeEmojis = (prefix: string, n: number, c: number): EmojiDatum[] =>
    Array.from({ length: n }, (_, i) => ({
        e: `${prefix}${i}`,
        n: `${prefix} ${i}`,
        c,
        o: c * 1000 + i,
    }));

const makeData = (): EmojiData => ({
    locale: 'en',
    categories: [{ key: 'cat-a', label: 'category a' }],
    emojis: makeEmojis('A', 24, 0),
    skinTones: [],
});

type TestNode = {
    _handlers: Map<string, (e?: unknown) => void>;
    children: TestNode[];
    textContent(): string;
};

async function measureRegion(container: unknown, width = 328): Promise<void> {
    const fire = (n: TestNode): boolean => {
        const h = n._handlers.get('bindlayoutchange');
        if (h) {
            h({ detail: { width, height: 600, top: 0, left: 0 } });
            return true;
        }
        return n.children.some(fire);
    };
    const root = container as TestNode;
    await act(() => { fire(root); });
    const deadline = Date.now() + 4000;
    let stable = 0;
    let last = -1;
    while (Date.now() < deadline && stable < 3) {
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
        const count = getAllByType(root as never, 'list-item').length;
        stable = count === last && count > 0 ? stable + 1 : 0;
        last = count;
    }
}

beforeAll(() => {
    (globalThis as { lynx?: unknown }).lynx = {
        __globalProps: { fontScale: { scale: SCALE, os: SCALE } },
    };
});

afterAll(() => {
    delete (globalThis as { lynx?: unknown }).lynx;
});

describe('emoji picker pinned under OS font scale (effective 1.5)', () => {
    it('cell glyph fontSize is counter-divided; row estimate/height unchanged', async () => {
        const { container } = render(
            <EmojiPicker data={makeData()} showSearch={false} showRecents={false} cellSize={32} />,
        );
        await measureRegion(container);

        const cell = getAllByType(container, 'list-item')
            .find((c) => c.props['item-type'] === 'emoji')!;
        expect(cell).toBeTruthy();
        // Geometry contract untouched: estimate == emojiRowPx(32), no scale.
        expect(cell.props['estimated-main-axis-size-px']).toBe(emojiRowPx(32));
        const text = getByType(cell as never, 'text');
        // Engine multiplies by 1.5 → renders exactly 32.
        expect((text.props['style'] as { fontSize: number }).fontSize).toBeCloseTo(32 / SCALE, 5);
    });

    it('section header label counter-divided; header height pinned', async () => {
        const { container } = render(
            <EmojiPicker data={makeData()} showSearch={false} showRecents={false} cellSize={32} />,
        );
        await measureRegion(container);

        const header = getAllByType(container, 'list-item')
            .find((c) => c.props['item-type'] === 'emoji-header')!;
        expect(header.props['estimated-main-axis-size-px']).toBe(HEADER_PX);
        const label = getByType(header as never, 'text');
        const fs = (label.props['style'] as { fontSize: string }).fontSize;
        expect(fs.endsWith('px')).toBe(true);
        // The picker derives the label from the cell font (EmojiPicker.tsx),
        // then the header counter-divides it by the OS scale.
        const expectedLabel = Math.round(32 * emojiInkRatio() * (0.28 / 0.64));
        expect(Number.parseFloat(fs)).toBeCloseTo(expectedLabel / SCALE, 5);
    });
});
