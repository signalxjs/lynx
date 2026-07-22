import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, getAllByType, getByType, act } from '@sigx/lynx-testing';

// The end-to-end iOS path (#761): the jsdom harness resolves Platform.OS to
// 'android' (see grid.test.tsx's guard), so the iOS ink ratio is exercised by
// substituting Platform at the module seam — metrics.ts reads `Platform.OS`
// lazily, so this mock is what every geometry resolution below sees.
vi.mock('@sigx/lynx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx')>();
    return { ...actual, Platform: { ...actual.Platform, OS: 'ios' as const } };
});

import { EmojiPicker } from '../src/components/EmojiPicker';
import { sectionStartOffsets } from '../src/components/EmojiGrid';
import { emojiRowPx } from '../src/components/EmojiCell';
import { HEADER_PX } from '../src/components/SectionHeader';
import { emojiInkRatio } from '../src/metrics';
import type { EmojiData, EmojiDatum } from '../src/data/schema';

const makeEmojis = (prefix: string, n: number, c: number): EmojiDatum[] =>
    Array.from({ length: n }, (_, i) => ({
        e: `${prefix}${i}`,
        n: `${prefix} ${i}`,
        c,
        o: c * 1000 + i,
    }));

const CAT_A = makeEmojis('A', 95, 0);
const CAT_B = makeEmojis('B', 30, 1);

const makeData = (): EmojiData => ({
    locale: 'en',
    categories: [
        { key: 'cat-a', label: 'category a' },
        { key: 'cat-b', label: 'category b' },
    ],
    emojis: [...CAT_A, ...CAT_B],
    skinTones: ['light', 'medium-light', 'medium', 'medium-dark', 'dark'],
});

type TestNode = { _handlers: Map<string, (e?: unknown) => void>; children: TestNode[] };

// Same warm + measure/stabilize harness as grid.test.tsx, at the #761 repro
// width: 402pt (iPhone 17 Pro). See grid.test.tsx for the rationale comments.
beforeAll(async () => {
    await import('@sigx/lynx-storage').catch(() => null);
});

async function measureRegion(container: unknown, width = 402): Promise<void> {
    const fire = (n: TestNode): boolean => {
        const h = n._handlers.get('bindlayoutchange');
        if (h) {
            h({ detail: { width, height: 600, top: 0, left: 0 } });
            return true;
        }
        return n.children.some(fire);
    };
    await act(() => { fire(container as TestNode); });
    const deadline = Date.now() + 4_000;
    let last = -1;
    let stableFor = 0;
    while (Date.now() < deadline) {
        const count = getAllByType(container as never, 'list-item').length;
        stableFor = count > 0 && count === last ? stableFor + 1 : 0;
        if (stableFor >= 2) return;
        last = count;
        await new Promise((r) => setTimeout(r, 0));
        await act(() => { fire(container as TestNode); });
    }
    throw new Error(`measureRegion: staged row count never stabilized (last saw ${last} list-items)`);
}

describe('adaptive sizing on the iOS ink path (#761)', () => {
    it('resolves the iOS ink ratio through the Platform seam', () => {
        expect(emojiInkRatio()).toBe(0.93);
    });

    it('402pt: 10 columns, 40px em, 46px rows — est == actual == offsets', async () => {
        const { container } = render(
            <EmojiPicker data={makeData()} showSearch={false} showRecents={false} />,
        );
        await measureRegion(container);

        // Geometry: floor(402/40) = 10 columns; the em fits the 40.2px cell
        // (was 58 pre-fix — the overlapping-glyph repro).
        const list = getByType(container, 'list');
        expect(list.props['span-count']).toBe(10);

        const cell = getAllByType(container, 'list-item')
            .find((c) => c.props['item-type'] === 'emoji')!;
        expect(cell.props['estimated-main-axis-size-px']).toBe(46); // round(40*0.93)+9
        const textEl = cell.children.find((c: { type?: string }) => (c as { type: string }).type === 'text') as
            | { props: Record<string, unknown> }
            | undefined;
        expect(textEl?.props['style']).toMatchObject({ fontSize: 40 });

        // The scroll-offset math saw the SAME platform ink as the pinned row
        // heights — the est == actual contract (#663) on the iOS path.
        expect(emojiRowPx(40)).toBe(46);
        const sections = [
            { key: 'cat-a', label: 'category a', emojis: CAT_A },
            { key: 'cat-b', label: 'category b', emojis: CAT_B },
        ];
        const offsets = sectionStartOffsets(sections, 10, 40);
        expect(offsets[1]).toBe(HEADER_PX + Math.ceil(CAT_A.length / 10) * 46);
    });
});
