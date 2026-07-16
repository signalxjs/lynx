import { defineInjectable } from '@sigx/lynx';
import type { EmojiData } from '../data/schema.js';
import { buildSearchIndex, type EmojiSearchIndex } from '../search/index.js';
import { createRecentsStore, type RecentsStore } from './recents.js';
import { createSkinToneStore, type SkinToneStore } from './skinTone.js';

/** Everything the picker surfaces share — dataset, search, recents, tone. */
export interface EmojiContextValue {
    data: EmojiData;
    index: EmojiSearchIndex;
    recents: RecentsStore;
    skinTone: SkinToneStore;
}

export interface EmojiContextOptions {
    /** Max recents kept/persisted. Default 32. */
    recentsCap?: number;
}

/**
 * Build a standalone context — what `<EmojiProvider>` installs, and what
 * `<EmojiPicker data={…}>` creates for itself when no provider is in scope.
 */
export function createEmojiContext(data: EmojiData, options?: EmojiContextOptions): EmojiContextValue {
    // Snapshot the dataset to plain objects. `data` is static by contract
    // ("fixed at mount") but usually arrives through component props, where
    // every read returns a deep reactive proxy: ~1900 entries' worth of
    // proxy overhead on every grid slice/search pass — and sharing one array
    // instance across two components' prop proxies currently blanks the
    // whole surface's paint on device (runtime issue signalxjs/lynx#603).
    // The dataset is JSON-parsed to begin with, so the round-trip is
    // lossless and runs once per provider.
    const raw = JSON.parse(JSON.stringify(data)) as EmojiData;
    return {
        data: raw,
        index: buildSearchIndex(raw),
        recents: createRecentsStore(raw, options?.recentsCap),
        skinTone: createSkinToneStore(),
    };
}

/**
 * The DI handle (same shape as lynx-safe-area's `useSafeAreaContext`):
 * `<EmojiProvider>` installs an instance via `defineProvide`; downstream
 * `useEmojiContext()` returns it, or `null` outside a provider — hooks and
 * components layer their own null handling on top.
 */
export const useEmojiContext = defineInjectable<EmojiContextValue | null>(() => null);
