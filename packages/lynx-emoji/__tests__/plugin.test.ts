import { describe, it, expect, vi } from 'vitest';
import type { TriggerSelectApi } from '@sigx/lynx-markdown';
import {
    createEmojiPlugin,
    createEmojiSyntax,
    emojiExtensionComponent,
} from '../src/markdown/index';

function selectApi(): TriggerSelectApi {
    return {
        replaceQuery: vi.fn(),
        range: { start: 0, end: 5 },
        controller: {} as TriggerSelectApi['controller'],
    };
}

describe('createEmojiSyntax', () => {
    const syntax = createEmojiSyntax();

    it('matches a known :shortcode: and resolves the glyph', () => {
        const m = syntax.match('go :joy: now', 3);
        expect(m).toMatchObject({
            node: { type: 'extension', name: 'emoji', attrs: { name: 'joy', glyph: '😂' }, raw: ':joy:' },
            end: 8,
        });
    });

    it('stays literal on partial tails and unknown shortcodes', () => {
        expect(syntax.match(':jo', 0)).toBeNull();
        expect(syntax.match(':definitely_not_an_emoji:', 0)).toBeNull();
        expect(syntax.match('plain text', 0)).toBeNull();
    });
});

describe('emojiExtensionComponent', () => {
    it('renders the glyph, falling back to the raw shortcode', () => {
        expect(emojiExtensionComponent({ attrs: { name: 'joy', glyph: '😂' }, children: [] } as never)).toBe('😂');
        expect(emojiExtensionComponent({ attrs: { name: 'joy' }, children: [] } as never)).toBe(':joy:');
    });
});

describe('createEmojiPlugin', () => {
    it('suggests ranked matches with glyph labels, none for an empty query', async () => {
        const plugin = createEmojiPlugin();
        expect(await plugin.trigger!.onQuery('')).toEqual([]);
        const items = await plugin.trigger!.onQuery('joy');
        expect(items.length).toBeGreaterThan(0);
        expect(items[0]).toMatchObject({ id: 'joy', glyph: '😂' });
        expect(items[0].label).toContain('😂');
        expect(items.length).toBeLessThanOrEqual(8);
    });

    it('inserts the glyph by default, with a boundary space', async () => {
        const plugin = createEmojiPlugin();
        const items = await plugin.trigger!.onQuery('joy');
        const api = selectApi();
        plugin.trigger!.onSelect(items[0], api);
        expect(api.replaceQuery).toHaveBeenCalledWith('😂 ');
    });

    it('inserts shortcode text in shortcode mode', async () => {
        const plugin = createEmojiPlugin({ insert: 'shortcode' });
        const items = await plugin.trigger!.onQuery('joy');
        const api = selectApi();
        plugin.trigger!.onSelect(items[0], api);
        expect(api.replaceQuery).toHaveBeenCalledWith(':joy: ');
    });

    it('adds the toolbar item only when onPickerRequest is provided', () => {
        expect(createEmojiPlugin().toolbar).toBeUndefined();
        const onPickerRequest = vi.fn();
        const plugin = createEmojiPlugin({ onPickerRequest });
        expect(plugin.toolbar).toHaveLength(1);
        plugin.toolbar![0].run({ controller: {} as never });
        expect(onPickerRequest).toHaveBeenCalled();
    });
});
