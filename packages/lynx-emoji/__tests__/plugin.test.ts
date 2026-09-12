import { describe, it, expect, vi } from 'vitest';
import type { InlineMatchContext } from '@sigx/lynx-markdown';
import type { TriggerSelectApi } from '@sigx/lynx-markdown/editor';
import {
    createEmojiPlugin,
    createEmojiSyntax,
    emojiComponent,
} from '../src/markdown/index';

/** A bare match context — no positions, no nested inline parsing. */
const ctx: InlineMatchContext = { parseInline: () => [], position: () => undefined };

function selectApi(): TriggerSelectApi {
    return {
        replaceQuery: vi.fn(),
        range: { key: 'b-0', from: 0, to: 5 },
        commands: {} as TriggerSelectApi['commands'],
        dispatch: vi.fn(),
        state: {} as TriggerSelectApi['state'],
        run: vi.fn(() => true),
    };
}

const triggerOf = (plugin: ReturnType<typeof createEmojiPlugin>) => plugin.editor!.triggers![0];

describe('createEmojiSyntax', () => {
    const syntax = createEmojiSyntax();

    it('matches a known :shortcode: into an emoji node carrying the glyph', () => {
        const m = syntax.match('go :joy: now', 3, ctx);
        expect(m).toEqual({ node: { type: 'emoji', name: 'joy', glyph: '😂' }, end: 8 });
    });

    it('records the source position when the parser offers one', () => {
        const position = { start: { line: 1, column: 4, offset: 3 }, end: { line: 1, column: 9, offset: 8 } };
        const m = syntax.match('go :joy: now', 3, { ...ctx, position: () => position });
        expect(m!.node.position).toBe(position);
    });

    it('stays literal on partial tails and unknown shortcodes', () => {
        expect(syntax.match(':jo', 0, ctx)).toBeNull();
        expect(syntax.match(':definitely_not_an_emoji:', 0, ctx)).toBeNull();
        expect(syntax.match('plain text', 0, ctx)).toBeNull();
    });
});

describe('emojiComponent', () => {
    it('renders the glyph, falling back to the shortcode', () => {
        expect(emojiComponent({ node: { type: 'emoji', name: 'joy', glyph: '😂' } })).toBe('😂');
        expect(emojiComponent({ node: { type: 'emoji', name: 'joy', glyph: '' } })).toBe(':joy:');
    });
});

describe('createEmojiPlugin', () => {
    it('suggests ranked matches with glyph labels, none for an empty query', async () => {
        const plugin = createEmojiPlugin();
        expect(await triggerOf(plugin).onQuery('')).toEqual([]);
        const items = await triggerOf(plugin).onQuery('joy');
        expect(items.length).toBeGreaterThan(0);
        expect(items[0]).toMatchObject({ id: 'joy', glyph: '😂' });
        expect(items[0].label).toContain('😂');
        expect(items.length).toBeLessThanOrEqual(8);
    });

    it('inserts the glyph by default, with a boundary space', async () => {
        const plugin = createEmojiPlugin();
        const items = await triggerOf(plugin).onQuery('joy');
        const api = selectApi();
        triggerOf(plugin).onSelect(items[0], api);
        expect(api.replaceQuery).toHaveBeenCalledWith({ text: '😂 ', spans: [] });
    });

    it('inserts shortcode text in shortcode mode', async () => {
        const plugin = createEmojiPlugin({ insert: 'shortcode' });
        const items = await triggerOf(plugin).onQuery('joy');
        const api = selectApi();
        triggerOf(plugin).onSelect(items[0], api);
        expect(api.replaceQuery).toHaveBeenCalledWith({ text: ':joy: ', spans: [] });
    });

    it('falls back to the glyph in shortcode mode when an emoji has no shortcode', async () => {
        const data = {
            locale: 'en',
            categories: [{ key: 'smileys-emotion', label: 'smileys & emotion' }],
            emojis: [{ e: '😀', n: 'grinning face', c: 0, o: 1, k: ['grin'] }], // no sc
            skinTones: ['light', 'medium-light', 'medium', 'medium-dark', 'dark'],
        };
        const plugin = createEmojiPlugin({ insert: 'shortcode', data });
        const items = await triggerOf(plugin).onQuery('grin');
        expect(items[0].sc).toBeUndefined();
        const api = selectApi();
        triggerOf(plugin).onSelect(items[0], api);
        expect(api.replaceQuery).toHaveBeenCalledWith({ text: '😀 ', spans: [] });
    });

    it('adds the toolbar item only when onPickerRequest is provided', () => {
        expect(createEmojiPlugin().editor!.toolbar).toBeUndefined();
        const onPickerRequest = vi.fn();
        const plugin = createEmojiPlugin({ onPickerRequest });
        expect(plugin.editor!.toolbar).toHaveLength(1);
        plugin.editor!.toolbar![0].run({} as never);
        expect(onPickerRequest).toHaveBeenCalled();
    });
});
