/**
 * Public-surface freeze test for @sigx/lynx-emoji.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect — for the
 *    root barrel and for both published subpaths (`./markdown`, `./data/en`),
 *    since `package.json#exports` makes each of them a separate promise to
 *    consumers.
 *  - Types: the load-bearing shapes are pinned. This is a pure-JS package
 *    with no native module, so there is no `isAvailable`/permission surface
 *    (C2/C6) to freeze; the weight goes on the geometry helpers every theme
 *    computes row math from and on the hook contract (C8).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as emoji from '../src/index';
import {
    emojiInkFor,
    emojiRowPx,
    emojiRowPxFor,
    glyphForTone,
    resolveEmojiGeometry,
    useKeyboardPanelReveal,
} from '../src/index';
import type {
    EmojiGridScrollHandle,
    EmojiSearchApi,
    KeyboardPanelReveal,
    KeyboardPanelRevealOptions,
    PanelRevealMode,
} from '../src/index';
import type { EmojiDatum, SkinTone } from '../src/data/schema';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(emoji).sort()).toEqual([
            'CategoryTabBar',
            'EMOJI_CATEGORY_ICONS',
            'EmojiCell',
            'EmojiGrid',
            'EmojiPicker',
            'EmojiProvider',
            'EmojiStrip',
            'HEADER_PX',
            'KeyboardPanelPicker',
            'SearchInput',
            'SectionHeader',
            'SkinTonePopover',
            'buildSearchIndex',
            'createEmojiContext',
            'createStagingDriver',
            'emojiInkFor',
            'emojiInkRatio',
            'emojiRowPx',
            'emojiRowPxFor',
            'enData',
            'glyphForTone',
            'resolveEmojiGeometry',
            'sectionRowIndex',
            'sectionStartOffsets',
            'tokenize',
            'useEmojiContext',
            'useKeyboardPanelReveal',
        ].sort());
    });

    it('keeps the /markdown subpath surface', async () => {
        // The plugin entry is a separate `exports` subpath so the core picker
        // stays free of the optional @sigx/lynx-markdown peer; dropping one of
        // these three breaks editors that never import the barrel at all.
        const markdown = await import('../src/markdown/index');
        expect(Object.keys(markdown).sort()).toEqual([
            'createEmojiPlugin',
            'createEmojiSyntax',
            'emojiExtensionComponent',
        ].sort());
    });

    it('keeps the /data/en subpath surface', async () => {
        // Apps that ship their own locale import `@sigx/lynx-emoji/data/<loc>`
        // and rely on the binding being named `data`, not `enData` — plus the
        // default export, so `import en from '…/data/en'` keeps working.
        const en = await import('../src/data/en.gen');
        expect(Object.keys(en).sort()).toEqual(['data', 'default'].sort());
    });
});

describe('public types', () => {
    it('pins the geometry helpers (the row-math contract)', () => {
        // Themes and the grid both derive scroll offsets from these; a changed
        // arity or a px/ratio swap silently mis-lands every section jump.
        expectTypeOf(emojiInkFor).parameters.toEqualTypeOf<[os: 'android' | 'ios' | 'web']>();
        expectTypeOf(emojiInkFor).returns.toEqualTypeOf<number>();
        expectTypeOf(emojiRowPxFor).toEqualTypeOf<(ink: number, size?: number) => number>();
        expectTypeOf(emojiRowPx).toEqualTypeOf<(size?: number) => number>();
        expectTypeOf(resolveEmojiGeometry).toEqualTypeOf<
            (
                regionWidth: number,
                ink: number,
                overrides?: { columns?: number; cellSize?: number },
                fontScale?: number,
            ) => { columns: number; cellSize: number }
        >();
    });

    it('pins glyphForTone as the tone resolver', () => {
        // The one function every consumer calls to turn a datum + the sticky
        // tone into the string it inserts.
        expectTypeOf(glyphForTone).toEqualTypeOf<(datum: EmojiDatum, tone: SkinTone) => string>();
    });

    it('pins the useKeyboardPanelReveal hook contract (C8)', () => {
        // A hook returning accessor functions, not raw values: `mode()` and
        // `engaged()` must stay callable, because callers pass them straight
        // into reactive props (`pinned={reveal.engaged}`).
        expectTypeOf(useKeyboardPanelReveal).toEqualTypeOf<
            (opts: KeyboardPanelRevealOptions) => KeyboardPanelReveal
        >();
        expectTypeOf<KeyboardPanelReveal['mode']>().toEqualTypeOf<() => PanelRevealMode>();
        expectTypeOf<KeyboardPanelReveal['engaged']>().toEqualTypeOf<() => boolean>();
        expectTypeOf<KeyboardPanelReveal['toggle']>().toEqualTypeOf<() => void>();
        expectTypeOf<PanelRevealMode>().toEqualTypeOf<'closed' | 'open' | 'closing'>();
    });

    it('pins the imperative + render-slot handles', () => {
        // `scrollHandle` is a mutable ref-shaped object the grid writes into;
        // making it a plain function or a signal would break every caller's
        // `.current?.(key)` scroll-to-section.
        expectTypeOf<EmojiGridScrollHandle>().toEqualTypeOf<{
            current: ((sectionKey: string) => void) | null;
        }>();
        // A custom search field drives the picker through this pair — `query`
        // is a reactive getter, so it must stay a function, not a string.
        expectTypeOf<EmojiSearchApi['query']>().toEqualTypeOf<() => string>();
        expectTypeOf<EmojiSearchApi['setQuery']>().toEqualTypeOf<(query: string) => void>();
    });
});
