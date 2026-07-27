/**
 * `<EmojiStrip>` — the one-row horizontal shape (#811): WhatsApp's search
 * results above the keyboard, and the same shape a reaction bar wants.
 * Unlike the grid it renders plain elements, so it can re-render per
 * keystroke without the grid's staging machinery.
 */

import { describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { EmojiStrip } from '../src/components/EmojiStrip';
import type { EmojiDatum } from '../src/data/schema';

const emoji = (i: number): EmojiDatum => ({ e: `E${i}`, n: `emoji ${i}`, c: 0, o: i });
const many = (n: number): EmojiDatum[] => Array.from({ length: n }, (_, i) => emoji(i));

type Node = {
    type?: string;
    props?: Record<string, any>;
    children?: Node[];
    textContent?: () => string;
};

function flatten(root: Node): Node[] {
    const out: Node[] = [];
    const walk = (n: Node | undefined): void => {
        if (!n) return;
        out.push(n);
        for (const c of n.children ?? []) walk(c);
    };
    walk(root);
    return out;
}

function mount(props: Record<string, unknown>): Node {
    // The tests drive props as a loose bag; the component's JSX type wants
    // `emojis` present, which every call site supplies.
    const Host = component(() => () => <EmojiStrip {...(props as { emojis: EmojiDatum[] })} />);
    const result: any = render(<Host />);
    return (result.container ?? result.root ?? result) as Node;
}

/** The tappable cells — square boxes carrying an accessibility label. */
const cells = (root: Node): Node[] =>
    flatten(root).filter((n) => n.props?.['accessibility-trait'] === 'button');

describe('<EmojiStrip>', () => {
    it('renders one tappable cell per emoji, in order', () => {
        const root = mount({ emojis: many(4) });
        const found = cells(root);
        expect(found).toHaveLength(4);
        expect(found.map((c) => c.props!['accessibility-label']))
            .toEqual(['emoji 0', 'emoji 1', 'emoji 2', 'emoji 3']);
    });

    it('caps at `limit` — a strip is a peek, and every cell is a real element', () => {
        expect(cells(mount({ emojis: many(200) }))).toHaveLength(48); // default
        expect(cells(mount({ emojis: many(200), limit: 6 }))).toHaveLength(6);
    });

    it('emits the picked datum, glyph and tone', () => {
        const onPick = vi.fn();
        const root = mount({ emojis: many(3), onPick });
        cells(root)[1]!.props!.bindtap();
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onPick.mock.calls[0]![0]).toMatchObject({ glyph: 'E1', tone: 0 });
        expect(onPick.mock.calls[0]![0].datum.n).toBe('emoji 1');
    });

    it('shows the empty label instead of a row when there is nothing to show', () => {
        const root = mount({ emojis: [], emptyLabel: 'No emoji found' });
        expect(cells(root)).toHaveLength(0);
        const text = flatten(root).find((n) => n.type === 'text');
        expect(text?.props?.children ?? text?.textContent?.()).toBe('No emoji found');
    });

    it('keeps a fixed row height so a sheet floor can budget for it', () => {
        // The composer adds STRIP_H to the sheet's search floor — the strip
        // must not size itself off its content.
        const root = mount({ emojis: many(3), cellSize: 28 });
        const scroller = flatten(root).find((n) => n.type === 'scroll-view');
        expect(scroller?.props?.style?.height).toMatch(/^\d+px$/);
    });
});
