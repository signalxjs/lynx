/**
 * `<EmojiPicker>` chrome layout (#811) — where the category tab bar sits and
 * how the grid's scroll inset is forwarded.
 *
 * `tabPlacement="bottom"` is the WhatsApp arrangement: the tab row is the
 * picker's LAST row, so a sheet can pin it to the visible bottom edge. That
 * is a document-ORDER contract (Lynx has no z-index — paint order is
 * document order), which is what these assert.
 */

import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { act, render } from '@sigx/lynx-testing';
import { EmojiPicker, EMOJI_CATEGORY_ICONS } from '../src/components/EmojiPicker';
import type { EmojiData, EmojiDatum } from '../src/data/schema';

const makeEmojis = (n: number): EmojiDatum[] =>
    Array.from({ length: n }, (_, i) => ({ e: `E${i}`, n: `emoji ${i}`, c: 0, o: i }));

const DATA: EmojiData = {
    locale: 'en',
    categories: [{ key: 'smileys-emotion', label: 'smileys & emotion' }],
    emojis: makeEmojis(24),
    skinTones: ['1', '2', '3', '4', '5'],
};

type Node = {
    type?: string;
    props?: Record<string, unknown>;
    children?: Node[];
};

/** Depth-first pre-order flatten — document order, i.e. paint order. */
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

const style = (n: Node): Record<string, unknown> =>
    (n.props?.style as Record<string, unknown> | undefined) ?? {};

/** The measured grid region — the only element with a layout binding. */
const isRegion = (n: Node): boolean => n.props?.bindlayoutchange !== undefined;

/** The tab bar's wrapper: `flexShrink: 0` column, no height of its own. */
const isTabBarWrap = (n: Node): boolean =>
    style(n).flexShrink === 0
    && style(n).flexDirection === 'column'
    && style(n).height === undefined;

async function mountPicker(props: Record<string, unknown>): Promise<Node> {
    const Host = component(() => () => <EmojiPicker data={DATA} showSearch={false} {...props} />);
    const result: any = render(<Host />);
    const root = () => (result.container ?? result.root ?? result) as Node;

    // The picker renders a measuring shell until persisted recents + tone have
    // hydrated (`ctx.ready`), and that runs through a dynamic import of the
    // optional storage peer. How many turns that takes is not fixed — it
    // depends on module-cache state, so it varies with which tests ran first.
    //
    // This used to pump a fixed 5 turns, which was right often enough to look
    // stable and wrong often enough to fail ~4 runs in 5 in isolation, with
    // `findIndex` returning -1 and the ordering assertion never running.
    // Waiting for the chrome to actually exist is what makes it deterministic.
    for (let i = 0; i < 50; i++) {
        const { region, tabBar } = placementIndices(root());
        if (region >= 0 && tabBar >= 0) return root();
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    // Fall through so the assertions report what was actually rendered rather
    // than a bare timeout.
    return root();
}

function placementIndices(root: Node): { region: number; tabBar: number } {
    const nodes = flatten(root);
    return {
        region: nodes.findIndex(isRegion),
        tabBar: nodes.findIndex(isTabBarWrap),
    };
}

describe('<EmojiPicker> tabPlacement', () => {
    it('puts the tab bar before the grid region by default', async () => {
        const { region, tabBar } = placementIndices(await mountPicker({}));
        expect(tabBar).toBeGreaterThanOrEqual(0);
        expect(region).toBeGreaterThanOrEqual(0);
        expect(tabBar).toBeLessThan(region);
    });

    it('puts the tab bar AFTER the grid region at tabPlacement="bottom"', async () => {
        const { region, tabBar } = placementIndices(await mountPicker({ tabPlacement: 'bottom' }));
        expect(tabBar).toBeGreaterThanOrEqual(0);
        expect(region).toBeGreaterThanOrEqual(0);
        expect(tabBar).toBeGreaterThan(region);
    });

    it('keeps the tab-bar wrapper style identity stable across renders', async () => {
        // A fresh style literal per render re-emits SET_STYLE, which would
        // clobber the main-thread transform a pinned bar rides on.
        const root = await mountPicker({ tabPlacement: 'bottom' });
        const wrap = flatten(root).find(isTabBarWrap);
        expect(wrap).toBeTruthy();
        const first = wrap!.props!.style;
        await act(async () => {});
        expect(flatten(root).find(isTabBarWrap)!.props!.style).toBe(first);
    });
});

describe('EMOJI_CATEGORY_ICONS', () => {
    it('names an icon for every CLDR group the bundled data ships, plus recents', () => {
        // Guards the map against a CLDR group rename silently losing its
        // icon (the render prop would fall through to a blank tab).
        for (const key of [
            'smileys-emotion', 'people-body', 'animals-nature', 'food-drink',
            'travel-places', 'activities', 'objects', 'symbols', 'flags',
        ]) {
            expect(EMOJI_CATEGORY_ICONS[key]).toBeTruthy();
        }
        expect(EMOJI_CATEGORY_ICONS.recents).toBe('clock');
    });
});
